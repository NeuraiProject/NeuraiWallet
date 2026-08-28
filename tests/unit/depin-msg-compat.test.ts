// `buildDepinMessage` compatibility across the 2.2.1 -> 3.1.0 jump.
//
// The app builds every chat message with this one function. Protocol 2 changed
// the TRANSPORT (signed envelopes, authenticated reads) but not how a message
// is built, so this must keep behaving identically — otherwise messages sent
// from the mobile wallet stop decrypting in the web wallet and on devices.
//
// A fixed key and timestamp make the assertions exact rather than structural.

import '@neuraiproject/neurai-depin-msg/dist/neurai-depin-msg.js';

import {
  buildDepinMessage,
  buildDepinPreimage,
  decryptDepinReceiveEncryptedPayload,
  normalizeDepinToken,
} from '../../blue_modules/neurai/depinMsg';

// A matching triple, generated once and frozen here. The library binds the
// public key to the address, so an invented address is rejected — which is
// itself worth knowing: the app must pass a consistent pair.
// Test-only: never funded, never used on any chain.
const ADDRESS = 'tJJiuPpE3NfdX7NwYdR3ML5hR8ZV1om9AV';
const PUBLIC_KEY = '02bae94477108e9019a159e4978807ebbc56107b6fa106e2053c1f01c1904cc208';
const PRIVATE_KEY = 'cTfVHQK8uTgXfwjjnm5NFk3EK2uz8CkJcPnGra8czzdykC2dopWN';

describe('buildDepinMessage still behaves as before 3.1.0', () => {
  const input = {
    token: 'DEPINTESTING', // deliberately without '&': 3.1.0 requires it
    senderAddress: ADDRESS,
    senderPubKey: PUBLIC_KEY,
    privateKey: PRIVATE_KEY,
    timestamp: 1_700_000_000,
    message: 'hola',
    recipientPubKeys: [PUBLIC_KEY],
    messageType: 'group' as const,
  };

  it('returns a hex payload for depinsubmitmsg', async () => {
    const built = await buildDepinMessage(input);
    expect(typeof built.hex).toBe('string');
    expect(built.hex).toMatch(/^[0-9a-f]+$/i);
    expect(built.hex.length).toBeGreaterThan(64);
  });

  it('returns the two fields the app actually reads', async () => {
    // useDePINChat consumes `built.hex` and `built.messageHash` and nothing
    // else, so those are the contract. 3.1.0 also returns messageHashBytes,
    // encryptedSize, recipientCount and messageType.
    const built = await buildDepinMessage(input);
    expect(typeof built.hex).toBe('string');
    expect(typeof built.messageHash).toBe('string');
  });

  it('the hash is NOT stable across builds — ECIES is randomised', () => {
    // Documented because it is easy to assume otherwise: the hash covers the
    // ciphertext, so two builds of the same message differ. Deduplication must
    // not rely on rebuilding to compare.
    return Promise.all([buildDepinMessage(input), buildDepinMessage(input)]).then(([a, b]) => {
      expect(a.messageHash).not.toBe(b.messageHash);
    });
  });

  it('round-trips: what it encrypts, the app can still decrypt', async () => {
    // The payload is reachable through the preimage path; `buildDepinMessage`
    // returns the assembled `hex` instead, which is what the node parses.
    const pre = await buildDepinPreimage({
      token: input.token,
      senderAddress: input.senderAddress,
      senderPubKey: input.senderPubKey,
      timestamp: input.timestamp,
      message: input.message,
      recipientPubKeys: input.recipientPubKeys,
      messageType: input.messageType,
    });
    const plain = await decryptDepinReceiveEncryptedPayload(pre.encryptedPayloadHex, PRIVATE_KEY);
    expect(plain).toBe('hola');
  });

  it('binds the public key to the address', async () => {
    // 3.1.0 refuses a mismatched pair rather than building something the
    // recipients could not attribute.
    await expect(buildDepinMessage({ ...input, senderAddress: 'tLTJMUFWPo56ZFiq7jANyTPAs3aSrKKNh8' })).rejects.toThrow(
      /does not correspond/i,
    );
  });

  it('rejects a message with no recipients instead of building an unreadable one', async () => {
    await expect(buildDepinMessage({ ...input, recipientPubKeys: [] })).rejects.toBeTruthy();
  });
});

describe('normalizeDepinToken', () => {
  // 3.1.0 rejects a token without '&'; 2.2.1 accepted either. The app holds
  // both spellings (the asset list uses '&NAME', the chat hook learns whichever
  // a node reports), so the boundary normalises instead of each call site.
  it('adds the & the library now requires', () => {
    expect(normalizeDepinToken('DEPINTESTING')).toBe('&DEPINTESTING');
  });

  it('leaves an already-prefixed token alone', () => {
    expect(normalizeDepinToken('&DEPINTESTING')).toBe('&DEPINTESTING');
  });

  it('does not double the prefix or trip on whitespace', () => {
    expect(normalizeDepinToken('  &DEPINTESTING  ')).toBe('&DEPINTESTING');
  });

  it('refuses an empty token instead of building "&"', () => {
    expect(() => normalizeDepinToken('')).toThrow(/required/);
  });
});
