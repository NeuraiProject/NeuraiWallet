// Sending under protocol 2.
//
// The value of this path is what it refuses. The old assembly asked the
// messaging server for each recipient's key with `getpubkey` and used the
// answer unchecked, so a hostile endpoint could return its own key for a real
// holder's address. `buildDepinMessageForPool` resolves the set itself and
// enforces the key-to-address binding, which is why the send goes through it.
//
// The cryptography is already proven by the library's own regtest e2e; what is
// tested here is the app's composition: that a truncated recipient list stops
// the send, and that the message is submitted through the verifying helper
// rather than a raw RPC.

import { sendDepinGroupMessage, softwareIdentity } from '../../blue_modules/neurai/depinSend';

const buildDepinMessageForPool = jest.fn();
const submitDepinMessage = jest.fn();
const createSoftwareIdentity = jest.fn();

jest.mock('../../blue_modules/neurai/depinMsg', () => ({
  __esModule: true,
  buildDepinMessageForPool: (...a: unknown[]) => buildDepinMessageForPool(...a),
  submitDepinMessage: (...a: unknown[]) => submitDepinMessage(...a),
  createSoftwareIdentity: (...a: unknown[]) => createSoftwareIdentity(...a),
  normalizeDepinToken: (t: string) => (t.startsWith('&') ? t : `&${t}`),
}));

const POOL_KEY = '02' + 'a'.repeat(64);
const POOL = {
  info: { token: '&DEPINTESTING', maxrecipients: 20, depinpoolpkey: POOL_KEY },
  firstContact: false,
  fingerprint: 'ab…cd',
} as never;

const identity = { address: 'tSENDER', publicKey: '02' + 'b'.repeat(64) } as never;
const call = jest.fn();

const send = () =>
  sendDepinGroupMessage({
    call,
    pool: POOL,
    identity,
    token: 'DEPINTESTING',
    message: 'hola',
    timestamp: 1_700_000_000,
    network: 'xna-test',
  });

beforeEach(() => {
  buildDepinMessageForPool.mockReset();
  submitDepinMessage.mockReset();
  submitDepinMessage.mockResolvedValue({ messageHash: 'from-pool' });
});

describe('sendDepinGroupMessage', () => {
  it('builds through the pool so the key-to-address binding is enforced', async () => {
    buildDepinMessageForPool.mockResolvedValue({ hex: 'aabb', messageHash: 'h', recipientCount: 3 });
    await send();

    const args = buildDepinMessageForPool.mock.calls[0][0];
    expect(args.token).toBe('&DEPINTESTING');
    expect(args.poolRoot).toBe('&DEPINTESTING');
    expect(args.maxRecipients).toBe(20);
    expect(args.identity).toBe(identity);
    // No recipient list is passed in: the library resolves and validates it.
    expect(args.recipientPubKeys).toBeUndefined();
  });

  it('submits through the verifying helper, not a raw RPC', async () => {
    buildDepinMessageForPool.mockResolvedValue({ hex: 'aabb', messageHash: 'h', recipientCount: 1 });
    const result = await send();

    expect(submitDepinMessage).toHaveBeenCalledWith(expect.objectContaining({ messageHex: 'aabb', identity, poolPublicKey: POOL_KEY }));
    expect(result.messageHash).toBe('from-pool');
  });

  it('REFUSES to send when the recipient list was truncated', async () => {
    // A truncated list is not a smaller group, it is an unknown one: holders
    // who should have received the message would silently miss it.
    buildDepinMessageForPool.mockResolvedValue({
      hex: 'aabb',
      messageHash: 'h',
      resolution: { recipientPubKeys: [], skipped: { noPubKeyComplete: false } },
    });

    await expect(send()).rejects.toThrow(/truncated/i);
    expect(submitDepinMessage).not.toHaveBeenCalled();
  });

  it('also refuses when the restricted list was cut short', async () => {
    buildDepinMessageForPool.mockResolvedValue({
      hex: 'aabb',
      messageHash: 'h',
      resolution: { recipientPubKeys: [], skipped: { restrictedComplete: false } },
    });
    await expect(send()).rejects.toThrow(/truncated/i);
  });

  it('a complete list sends normally', async () => {
    buildDepinMessageForPool.mockResolvedValue({
      hex: 'aabb',
      messageHash: 'h',
      recipientCount: 2,
      resolution: { recipientPubKeys: ['a', 'b'], skipped: { noPubKeyComplete: true, restrictedComplete: true } },
    });
    await expect(send()).resolves.toMatchObject({ recipientCount: 2, truncated: false });
  });
});

describe('softwareIdentity', () => {
  it('is built from the wallet key and typed as the shared identity', async () => {
    createSoftwareIdentity.mockResolvedValue(identity);
    await softwareIdentity('cWIF', 'xna-test');
    expect(createSoftwareIdentity).toHaveBeenCalledWith({ privateKey: 'cWIF', network: 'xna-test' });
  });
});
