// Sending to one holder instead of to everyone.
//
// This exists because of a real defect: the send path built a correctly
// addressed private message and then discarded it, submitting a GROUP message
// in its place. Every "private" message went to every holder of the token —
// silently, since the sender's own copy looked right.

import { sendDepinPrivateMessage, verifiedRecipients } from '../../blue_modules/neurai/depinSend';

const buildDepinMessage = jest.fn();
const submitDepinMessage = jest.fn();
const verifyDepinReply = jest.fn();
const decodePlainReply = jest.fn();
const decodeDepinRecipients = jest.fn();

jest.mock('../../blue_modules/neurai/depinMsg', () => ({
  __esModule: true,
  buildDepinMessage: (...a: unknown[]) => buildDepinMessage(...a),
  buildDepinMessageForPool: jest.fn(),
  createSoftwareIdentity: jest.fn(),
  submitDepinMessage: (...a: unknown[]) => submitDepinMessage(...a),
  verifyDepinReply: (...a: unknown[]) => verifyDepinReply(...a),
  decodePlainReply: (...a: unknown[]) => decodePlainReply(...a),
  decodeDepinRecipients: (...a: unknown[]) => decodeDepinRecipients(...a),
  normalizeDepinToken: (t: string) => (t.startsWith('&') ? t : `&${t}`),
}));

const POOL_KEY = '02' + 'a'.repeat(64);
const THEM_KEY = '02' + '1'.repeat(64);
const TOKEN = '&DEPINTESTING';
const ME = 'tME';
const THEM = 'tTHEM';

const pool = {
  info: { token: TOKEN, maxrecipients: 20, depinpoolpkey: POOL_KEY },
} as never;

const identity = { address: ME, publicKey: '02' + 'b'.repeat(64) } as never;
const call = jest.fn();

const send = (toAddress = THEM) =>
  sendDepinPrivateMessage({
    call,
    pool,
    identity,
    token: TOKEN,
    toAddress,
    message: 'hola',
    timestamp: 1_700_000_000,
    network: 'testnet',
    senderPubKey: '02' + 'b'.repeat(64),
    privateKey: 'cWIF',
  });

beforeEach(() => {
  for (const m of [buildDepinMessage, submitDepinMessage, verifyDepinReply, decodePlainReply, decodeDepinRecipients]) {
    m.mockReset();
  }
  verifyDepinReply.mockReturnValue({ branded: true });
  decodePlainReply.mockReturnValue({
    token: TOKEN,
    recipients: [
      { address: THEM, pubkey: THEM_KEY },
      { address: 'tOTHER', pubkey: '02' + '2'.repeat(64) },
    ],
  });
  decodeDepinRecipients.mockResolvedValue({ recipientPubKeys: [], recipientCount: 2, skipped: {} });
  buildDepinMessage.mockResolvedValue({ hex: 'ccdd', messageHash: 'priv', recipientCount: 2 });
  submitDepinMessage.mockResolvedValue({ messageHash: 'from-pool' });
});

describe('sendDepinPrivateMessage', () => {
  it('encrypts to the recipient only, and submits THAT message', () => {
    // The regression: what is built must be what is sent.
    return send().then(result => {
      const built = buildDepinMessage.mock.calls[0][0];
      expect(built.recipientPubKeys).toEqual([THEM_KEY]);
      expect(built.messageType).toBe('private');
      expect(submitDepinMessage).toHaveBeenCalledWith(expect.objectContaining({ messageHex: 'ccdd' }));
      expect(result.messageHash).toBe('from-pool');
    });
  });

  it('does not encrypt to the other holders', async () => {
    await send();
    const built = buildDepinMessage.mock.calls[0][0];
    expect(built.recipientPubKeys).not.toContain('02' + '2'.repeat(64));
    expect(built.recipientPubKeys).toHaveLength(1);
  });

  it('carries the routing tag inside the encrypted payload', async () => {
    // The envelope names the sender only. Without this the sender cannot place
    // their own message in a conversation from another device.
    await send();
    expect(buildDepinMessage.mock.calls[0][0].message).toBe(`@${THEM} hola`);
  });

  it('takes the key from the verified list, never from the caller', async () => {
    await send();
    expect(verifyDepinReply).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'depingetancestorrecipients', poolPublicKey: POOL_KEY }),
    );
    expect(decodePlainReply).toHaveBeenCalledWith({ branded: true });
  });

  it('refuses an address that is not a holder with a published key', async () => {
    await expect(send('tSTRANGER')).rejects.toThrow(/not a holder/i);
    expect(buildDepinMessage).not.toHaveBeenCalled();
    expect(submitDepinMessage).not.toHaveBeenCalled();
  });

  it('refuses the whole list when the library rejects the body', async () => {
    decodeDepinRecipients.mockRejectedValue(new Error('Recipient pubkey does not match its address'));
    await expect(send()).rejects.toThrow(/does not match its address/);
  });
});

describe('verifiedRecipients', () => {
  it('asks for one more than the pool limit, so "at" and "over" stay distinct', async () => {
    await verifiedRecipients({ call, pool, token: TOKEN, senderPubKey: '02' + 'b'.repeat(64), network: 'testnet' });
    expect(call).toHaveBeenCalledWith('depingetancestorrecipients', [TOKEN, 21, TOKEN]);
  });
});
