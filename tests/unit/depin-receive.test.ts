// Authenticated receive: the challenge chain.
//
// A nonce is single-use and expires in 30 s; each authenticated reply hands
// back a `next_challenge` valid 300 s. Getting this wrong does not fail loudly
// — the node just rejects the read and the channel stalls — so what these
// tests pin is when a challenge is reused, when a new one is requested, and
// that the chain never runs two reads on the same nonce.
//
// The cryptography (pool signature, sender signature, scope, size) lives in
// the library and is covered by its own regtest e2e.

import {
  explainDepinReceiveRejection,
  isChallengeUsable,
  readableMessages,
  receiveDepinPage,
} from '../../blue_modules/neurai/depinReceive';

const requestDepinChallenge = jest.fn();
const receiveDepinMessages = jest.fn();

jest.mock('../../blue_modules/neurai/depinMsg', () => ({
  __esModule: true,
  requestDepinChallenge: (...a: unknown[]) => requestDepinChallenge(...a),
  depinNetwork: () => 'test',
  receiveDepinMessages: (...a: unknown[]) => receiveDepinMessages(...a),
}));

const NOW = 1_700_000_000_000;
const identity = { address: 'tME', publicKey: '02' + 'b'.repeat(64) } as never;
const call = jest.fn();

const context = {
  network: 'net',
  pool_pubkey: 'key',
  pool_root: '&DEPINTESTING',
  instance_id: 'instance',
  membership_revision: 'revision',
  membership_height: 1,
  membership_blockhash: 'block',
};
const pool = { context, pin: { serviceId: 'service' } } as never;
const contextKey = ['service', 'net', 'key', '&DEPINTESTING', 'instance', 'revision', '&DEPINTESTING', 'tME'].join('|');
const cursor = {
  version: 1 as const,
  stream_id: '11'.repeat(32),
  after_seq: 9007199254740993n,
  scope: '&DEPINTESTING',
  address: 'tME',
  from_timestamp: 0,
};

const read = (previous?: unknown, nowMs = NOW) =>
  receiveDepinPage({
    call,
    identity,
    token: '&DEPINTESTING',
    pool,
    network: 'xna-test',
    previous: previous as never,
    nowMs,
  });

beforeEach(() => {
  requestDepinChallenge.mockReset();
  receiveDepinMessages.mockReset();
  requestDepinChallenge.mockResolvedValue({ contextKey, challenge: 'FRESH', expiresIn: 30, context });
  receiveDepinMessages.mockResolvedValue({ messages: [], hasMore: false, cursor, context, nextChallenge: 'NEXT', nextExpiresIn: 300 });
});

describe('receiveDepinPage', () => {
  it('asks for a challenge when there is none to carry', async () => {
    await read(null);
    expect(requestDepinChallenge).toHaveBeenCalledTimes(1);
    expect(requestDepinChallenge.mock.calls[0][0].type).toBe('receive');
    expect(receiveDepinMessages.mock.calls[0][0].challenge).toBe('FRESH');
  });

  it('reuses a chained challenge instead of spending a new one', async () => {
    await read({ contextKey, challenge: 'CHAINED', expiresAtMs: NOW + 300_000 });
    expect(requestDepinChallenge).not.toHaveBeenCalled();
    expect(receiveDepinMessages.mock.calls[0][0].challenge).toBe('CHAINED');
  });

  it('carries the next challenge forward with an absolute deadline', async () => {
    const page = await read(null);
    expect(page.next).toEqual({ contextKey, challenge: 'NEXT', expiresAtMs: NOW + 300_000 });
  });

  it('requests a fresh one when the carried challenge expired', async () => {
    await read({ contextKey, challenge: 'STALE', expiresAtMs: NOW - 1 });
    expect(requestDepinChallenge).toHaveBeenCalledTimes(1);
    expect(receiveDepinMessages.mock.calls[0][0].challenge).toBe('FRESH');
  });

  it('does not cut it fine: a challenge about to expire is replaced', async () => {
    // A round trip can outlive the last second of validity, and the node would
    // reject the read. The margin buys that back.
    await read({ contextKey, challenge: 'ALMOST', expiresAtMs: NOW + 2_000 });
    expect(requestDepinChallenge).toHaveBeenCalledTimes(1);
  });

  it('restarts the chain when the reply carries no next challenge', async () => {
    receiveDepinMessages.mockResolvedValue({ messages: [], hasMore: false, cursor, context, nextChallenge: null });
    const page = await read(null);
    expect(page.next).toBeNull();
  });

  it('passes pagination through untouched', async () => {
    await receiveDepinPage({
      call,
      identity,
      token: '&DEPINTESTING',
      pool,
      network: 'xna-test',
      previous: { contextKey, challenge: 'C', expiresAtMs: NOW + 300_000 },
      cursor,
      limit: 25,
      nowMs: NOW,
    });
    expect(receiveDepinMessages.mock.calls[0][0]).toMatchObject({ cursor, limit: 25 });
  });
});

describe('isChallengeUsable', () => {
  it('rejects a missing or empty challenge', () => {
    expect(isChallengeUsable(null, NOW)).toBe(false);
    expect(isChallengeUsable({ contextKey, challenge: '', expiresAtMs: NOW + 300_000 }, NOW)).toBe(false);
  });

  it('accepts one with room to spare and rejects one without', () => {
    expect(isChallengeUsable({ contextKey, challenge: 'C', expiresAtMs: NOW + 300_000 }, NOW)).toBe(true);
    expect(isChallengeUsable({ contextKey, challenge: 'C', expiresAtMs: NOW + 1_000 }, NOW)).toBe(false);
  });
});

describe('readableMessages', () => {
  const entry = (over: Record<string, unknown>) => ({
    ok: true,
    hash: 'a'.repeat(64),
    plaintext: 'hola',
    message: { sender: 'tHOLDER', timestamp: 1_700_000_000, messageType: 'group' },
    ...over,
  });

  it('keeps an authentic, readable message', () => {
    expect(readableMessages([entry({})])).toEqual([
      { hash: 'a'.repeat(64), sender: 'tHOLDER', timestamp: 1_700_000_000, messageType: 'group', plaintext: 'hola' },
    ]);
  });

  it('drops an entry whose sender did not verify, readable or not', () => {
    // Independent of decryption on purpose: `ok` is the authenticity verdict,
    // and a message that opens is not thereby proven to come from its sender.
    expect(readableMessages([entry({ ok: false })])).toEqual([]);
  });

  it('skips traffic addressed to other holders', () => {
    expect(readableMessages([entry({ plaintext: null })])).toEqual([]);
    expect(readableMessages([entry({ plaintext: '' })])).toEqual([]);
  });

  it('ignores an entry with no hash to identify it by', () => {
    expect(readableMessages([entry({ hash: '' })])).toEqual([]);
  });

  it('tolerates a missing message envelope', () => {
    const [msg] = readableMessages([entry({ message: undefined })]);
    expect(msg.sender).toBe('');
    expect(msg.messageType).toBe('group');
  });
});

describe('explainDepinReceiveRejection', () => {
  it('explains the address whose public key the chain has never seen', () => {
    // Observed against the live testnet node: the state a fresh wallet is in,
    // and one that never resolves by retrying.
    const raw = '{"code":-32600,"message":"Address t82W5tEXrTrPFoNa7pMzXC4AGoGWbMQA2b has not revealed its public key"}';
    expect(explainDepinReceiveRejection(raw)).toMatch(/never sent a transaction/i);
  });

  it('reads it off an Error as well as a string', () => {
    expect(explainDepinReceiveRejection(new Error('Address tX has not revealed its public key'))).toMatch(/public key/i);
  });

  it('marks an expired challenge as self-correcting', () => {
    expect(explainDepinReceiveRejection('Unknown or expired challenge')).toMatch(/next attempt/i);
  });

  it('explains a non-holder', () => {
    expect(explainDepinReceiveRejection('Address tX does not hold token &TEST')).toMatch(/does not hold the token/i);
  });

  it('leaves anything else to the generic handling', () => {
    expect(explainDepinReceiveRejection('connection refused')).toBeNull();
    expect(explainDepinReceiveRejection(undefined)).toBeNull();
  });
});
