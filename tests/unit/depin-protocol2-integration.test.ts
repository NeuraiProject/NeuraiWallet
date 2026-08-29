// Protocol 2, end to end through the app's own modules, against the REAL
// library — nothing from `depinMsg` is mocked here.
//
// The cryptography itself is not re-proven: `neurai-depin-msg`'s regtest e2e
// already does that against a live node, and duplicating it would only create
// a second, weaker oracle. What is proven here is the part that lives in this
// repo — that the app composes the library correctly, and above all the order
// the protocol depends on:
//
//     verify the envelope  →  only then decrypt
//
// So the pool in these tests is simulated, but its `poolsig` is a REAL
// signature over the REAL preimage, produced with a real key. The verification
// path exercised is the library's, unmodified. The one seam is the identity's
// `openReply`, replaced by a spy: that is the decryptor, and asserting it was
// never called is what makes "an invalid envelope is refused before decoding"
// a fact rather than a claim.

import '@neuraiproject/neurai-depin-msg/dist/neurai-depin-msg.js';
import { DepinPoolPinMismatchError, getVerifiedPool, getVerifiedPoolStats } from '../../blue_modules/neurai/depinPool';
import { readableMessages, receiveDepinPage } from '../../blue_modules/neurai/depinReceive';
import { softwareIdentity } from '../../blue_modules/neurai/depinSend';
import type { RawRpcCall } from '../../blue_modules/neurai/depinRpcAdapter';

const storage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => storage.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      storage.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      storage.delete(k);
    }),
  },
}));

// The bundle publishes no ESM named exports, so the pool simulator reaches its
// signing primitives through the global the IIFE installs.
type LibFn = (...args: unknown[]) => Promise<any> | any;
const lib = (globalThis as { neuraiDepinMsg?: Record<string, LibFn> }).neuraiDepinMsg!;

const POOL_PRIV = 'a'.repeat(63) + '1';
const HOLDER_PRIV = 'b'.repeat(63) + '2';
const SENDER_PRIV = 'c'.repeat(63) + '3';
const TOKEN = '&TEST';
const URL = 'http://pool.invalid:9999/';

const toHex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

/**
 * A pool that signs exactly like the node does.
 *
 * `poolsig` is a real recoverable signature over `DEPIN-RESP|method|token|
 * address|challenge|sha256(replyHex)`, so every check the library runs is a
 * real check. Bound replies carry an opaque hex the spy identity resolves,
 * which keeps the transport encryption out of scope without weakening a single
 * verification step.
 */
class FakePool {
  poolPriv = POOL_PRIV;
  poolPub = '';
  poolAddress = '';
  /** Bound-reply payloads, by the hex that stands in for their ciphertext. */
  bodies = new Map<string, string>();
  messages: any[] = [];
  private nonces = 0;
  challengeExpiresIn = 30;
  issued: string[] = [];
  /** Nonces already spent, so replay is refused the way the node refuses it. */
  spent = new Set<string>();
  calls: string[] = [];
  /** Applied to every reply just before it is returned — the MITM seam. */
  tamper: ((method: string, reply: any) => any) | null = null;

  async init() {
    const identity = await lib.createSoftwareIdentity({ privateKey: this.poolPriv, network: 'test' });
    this.poolPub = identity.publicKey;
    this.poolAddress = identity.address;
  }

  /** A distinct 64-hex nonce, tracked as issued. */
  private mintChallenge(): string {
    const challenge = String(++this.nonces).padStart(64, '0');
    this.issued.push(challenge);
    return challenge;
  }

  private async sign(method: string, replyHex: string, token = '', address = '', challenge = '') {
    const preimage = lib.buildDepinReplyPreimage({ method, token, address, challenge, replyHex });
    return lib.signRecoverableMessage(preimage, this.poolPriv);
  }

  private async plain(method: string, body: unknown, token = '', address = '', challenge = '') {
    const replyHex = toHex(JSON.stringify(body));
    return { body: replyHex, poolsig: await this.sign(method, replyHex, token, address, challenge) };
  }

  private async bound(method: string, body: unknown, token: string, address: string, challenge: string) {
    // Stands in for the ECIES ciphertext: opaque hex the spy resolves.
    const replyHex = Buffer.from(`${method}:${this.bodies.size}`, 'utf8').toString('hex');
    this.bodies.set(replyHex, JSON.stringify(body));
    return { encrypted: replyHex, poolsig: await this.sign(method, replyHex, token, address, challenge) };
  }

  info() {
    return {
      protocol: 2,
      token: TOKEN,
      maxrecipients: 20,
      depinpoolpkey: this.poolPub,
      depinpoolkeyaddress: this.poolAddress,
      enabled: true,
    };
  }

  call: RawRpcCall = async (method, params) => {
    this.calls.push(method);
    const reply = await this.route(method, params ?? []);
    return this.tamper ? this.tamper(method, reply) : reply;
  };

  private async route(method: string, params: unknown[]): Promise<unknown> {
    if (method === 'depingetmsginfo') return this.plain(method, this.info(), TOKEN);

    if (method === 'depinpoolstats') {
      return this.plain(method, { enabled: true, token: TOKEN, total_messages: this.messages.length, newest_message: 'ff' }, TOKEN);
    }

    if (method === 'depinchallenge') {
      const [token, address] = params as [string, string];
      const challenge = this.mintChallenge();
      return this.bound(method, { challenge, expires_in: this.challengeExpiresIn, type: 'receive' }, token, address, '');
    }

    if (method === 'depinreceivemsg') {
      const [token, address, challenge] = params as [string, string, string];
      if (!this.issued.includes(challenge)) throw new Error('Unknown or expired challenge');
      if (this.spent.has(challenge)) throw new Error('Challenge already used');
      this.spent.add(challenge);
      const chained = this.mintChallenge();
      return this.bound(
        method,
        { messages: this.messages, has_more: false, next_challenge: chained, next_expires_in: 300 },
        token,
        address,
        challenge,
      );
    }

    throw new Error(`unexpected RPC ${method}`);
  }
}

/** The wallet identity, with the decryptor replaced by an observable spy. */
async function spyIdentity(pool: FakePool, privateKey = HOLDER_PRIV) {
  const real = await softwareIdentity(privateKey, 'testnet');
  const openReply = jest.fn(async (hex: string) => {
    // Bound replies are simulated; anything else is a real message payload and
    // goes through the real ECIES decryption with the wallet key.
    const body = pool.bodies.get(hex);
    return body === undefined ? real.openReply!(hex) : body;
  });
  return { identity: { ...real, openReply } as any, openReply };
}

/** A real, signed message from another holder, in the shape the node serves. */
async function realMessage(text: string, recipientPubKeys: string[]) {
  const sender = await lib.createSoftwareIdentity({ privateKey: SENDER_PRIV, network: 'test' });
  const built = await lib.buildDepinMessage({
    token: TOKEN,
    senderAddress: sender.address,
    senderPubKey: sender.publicKey,
    privateKey: SENDER_PRIV,
    timestamp: 1_700_000_000,
    message: text,
    recipientPubKeys,
    messageType: 'group',
  });
  return lib.parseDepinMessage(built.hex);
}

let pool: FakePool;

beforeEach(async () => {
  storage.clear();
  pool = new FakePool();
  await pool.init();
});

describe('pool trust, against real signatures', () => {
  it('accepts a correctly signed pool and pins the key it saw', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    expect(verified.firstContact).toBe(true);
    expect(verified.info.depinpoolpkey).toBe(pool.poolPub);
  });

  it('REFUSES a rotated pool key instead of adopting it', async () => {
    await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });

    // Same endpoint, different key: this is the substitution the pin exists for.
    const impostor = new FakePool();
    impostor.poolPriv = '2'.repeat(63) + '4';
    await impostor.init();

    await expect(getVerifiedPool({ call: impostor.call, network: 'testnet', url: URL })).rejects.toBeInstanceOf(DepinPoolPinMismatchError);
  });

  it('rejects a mutated poolsig on the info reply', async () => {
    pool.tamper = (_m, reply) => ({ ...reply, poolsig: `A${String(reply.poolsig).slice(1)}` });
    await expect(getVerifiedPool({ call: pool.call, network: 'testnet', url: URL })).rejects.toThrow();
  });

  it('reads pool stats through the signed envelope', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    pool.messages = [1, 2, 3];
    const stats = await getVerifiedPoolStats({ call: pool.call, pool: verified });
    // The raw reply carries no such field; getting it back proves the body was
    // verified and decoded rather than read off the envelope.
    expect(stats.total_messages).toBe(3);
  });

  it('refuses stats whose body was swapped under a stale signature', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    pool.tamper = (m, reply) => (m === 'depinpoolstats' ? { ...reply, body: toHex('{"total_messages":9999}') } : reply);
    await expect(getVerifiedPoolStats({ call: pool.call, pool: verified })).rejects.toThrow();
  });
});

describe('authenticated receive', () => {
  it('reads a real message and never decrypts before verifying', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity, openReply } = await spyIdentity(pool);
    pool.messages = [await realMessage('hola', [identity.publicKey])];

    const page = await receiveDepinPage({
      call: pool.call,
      identity,
      token: TOKEN,
      poolPublicKey: verified.info.depinpoolpkey,
      network: 'testnet',
    });

    const readable = readableMessages(page.messages);
    expect(readable).toHaveLength(1);
    expect(readable[0].messageType).toBe('group');
    // The chain continues without a second `depinchallenge`.
    expect(page.next?.challenge).toBe(pool.issued[pool.issued.length - 1]);
    expect(openReply).toHaveBeenCalled();
  });

  it('a mutated poolsig on the page is refused BEFORE the decryptor runs', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity, openReply } = await spyIdentity(pool);
    pool.messages = [await realMessage('hola', [identity.publicKey])];
    openReply.mockClear();

    pool.tamper = (m, reply) => (m === 'depinreceivemsg' ? { ...reply, poolsig: `A${String(reply.poolsig).slice(1)}` } : reply);

    await expect(
      receiveDepinPage({ call: pool.call, identity, token: TOKEN, poolPublicKey: verified.info.depinpoolpkey, network: 'testnet' }),
    ).rejects.toThrow();

    // Non-vacuous on both sides: the challenge reply WAS opened, so the spy is
    // wired and reachable, and the tampered page was NOT. That ordering —
    // verify, then decrypt — is what the whole protocol rests on.
    const opened = openReply.mock.calls.map(([hex]) => String(pool.bodies.get(hex as string)));
    expect(opened.some(body => body.includes('challenge'))).toBe(true);
    expect(opened.some(body => body.includes('has_more'))).toBe(false);
  });

  it('a page signed by another key is refused', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity } = await spyIdentity(pool);

    // The endpoint keeps answering, but from here on it signs with its own key.
    pool.poolPriv = '3'.repeat(63) + '5';

    await expect(
      receiveDepinPage({ call: pool.call, identity, token: TOKEN, poolPublicKey: verified.info.depinpoolpkey, network: 'testnet' }),
    ).rejects.toThrow(/poolsig/i);
  });

  it('a mutated ciphertext fails the sender signature and is never shown', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity } = await spyIdentity(pool);
    const message = await realMessage('hola', [identity.publicKey]);
    // Flip one byte of the payload the sender signed over.
    const payload = message.encryptedPayloadHex;
    pool.messages = [{ ...message, encryptedPayloadHex: `${payload.slice(0, -2)}${payload.slice(-2) === 'ff' ? '00' : 'ff'}` }];

    const page = await receiveDepinPage({
      call: pool.call,
      identity,
      token: TOKEN,
      poolPublicKey: verified.info.depinpoolpkey,
      network: 'testnet',
    });

    expect(page.messages[0].ok).toBe(false);
    expect(readableMessages(page.messages)).toHaveLength(0);
  });

  it('a message from outside the requested token is dropped', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity } = await spyIdentity(pool);
    const message = await realMessage('hola', [identity.publicKey]);
    pool.messages = [{ ...message, token: '&OTHER' }];

    const page = await receiveDepinPage({
      call: pool.call,
      identity,
      token: TOKEN,
      poolPublicKey: verified.info.depinpoolpkey,
      network: 'testnet',
    });
    expect(readableMessages(page.messages)).toHaveLength(0);
  });

  it('a spent challenge is not reused: the chain moves on', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity } = await spyIdentity(pool);
    const args = { call: pool.call, identity, token: TOKEN, poolPublicKey: verified.info.depinpoolpkey, network: 'testnet' as const };

    const first = await receiveDepinPage(args);
    // Carrying the spent nonce forward would be rejected by the node; carrying
    // the chained one is what keeps the poll from asking for a new challenge.
    const second = await receiveDepinPage({ ...args, previous: first.next });
    expect(second.messages).toEqual([]);
    expect(pool.calls.filter(c => c === 'depinchallenge')).toHaveLength(1);
  });

  it('an expired challenge is replaced rather than sent', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity } = await spyIdentity(pool);
    const args = { call: pool.call, identity, token: TOKEN, poolPublicKey: verified.info.depinpoolpkey, network: 'testnet' as const };

    const first = await receiveDepinPage(args);
    const expired = { challenge: first.next!.challenge, expiresAtMs: Date.now() - 1 };
    await receiveDepinPage({ ...args, previous: expired });

    expect(pool.calls.filter(c => c === 'depinchallenge')).toHaveLength(2);
  });

  it('DROPS a protocol-1 message even though it decrypts perfectly', async () => {
    // The dangerous case, and the only one where authenticity and readability
    // come apart: 65 zero bytes instead of a signature. Protocol 1 let the
    // gateway vouch for the sender, which is not something a client can check,
    // so the payload opens fine and the sender is still unproven. Filtering on
    // "did it decrypt?" alone would show it.
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity } = await spyIdentity(pool);
    const message = await realMessage('trust me', [identity.publicKey]);
    pool.messages = [{ ...message, signatureHex: '00'.repeat(65) }];

    const page = await receiveDepinPage({
      call: pool.call,
      identity,
      token: TOKEN,
      poolPublicKey: verified.info.depinpoolpkey,
      network: 'testnet',
    });

    expect(page.messages[0].ok).toBe(false);
    expect(page.messages[0].plaintext).toBeNull();
    expect(readableMessages(page.messages)).toHaveLength(0);
  });

  it('a message addressed to someone else is authentic but not readable', async () => {
    const verified = await getVerifiedPool({ call: pool.call, network: 'testnet', url: URL });
    const { identity } = await spyIdentity(pool);
    const stranger = await lib.createSoftwareIdentity({ privateKey: '9'.repeat(64), network: 'test' });
    pool.messages = [await realMessage('not for you', [stranger.publicKey])];

    const page = await receiveDepinPage({
      call: pool.call,
      identity,
      token: TOKEN,
      poolPublicKey: verified.info.depinpoolpkey,
      network: 'testnet',
    });

    // Verified sender, no plaintext for us: routine group traffic, not an error.
    expect(page.messages[0].ok).toBe(true);
    expect(readableMessages(page.messages)).toHaveLength(0);
  });
});
