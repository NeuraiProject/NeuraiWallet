// neurai_getAccountXpub for Neurai Connect.
//
// The key shared is the ACCOUNT key, and its children 0/i and 1/i must be the
// very addresses the wallet derives, or a site following it would see another
// wallet.

import { getAddressPair, getHDKey, HDKey, publicKeyToAddress } from '@neuraiproject/neurai-key';
import { accountXpub } from '../../blue_modules/neurai/connect/xpub';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('account extended public key', () => {
  it('is the account key of each family, never the master', () => {
    expect(accountXpub('xna-legacy-test', MNEMONIC)).toMatchObject({ path: "m/44'/1'/0'", addressType: 'legacy' });
    expect(accountXpub('xna-test', MNEMONIC)).toMatchObject({ path: "m/84'/1'/0'", addressType: 'ecdsa' });
    expect(accountXpub('xna-legacy', MNEMONIC)).toMatchObject({ path: "m/44'/1900'/0'", addressType: 'legacy' });
    expect(accountXpub('xna-test', MNEMONIC).xpub.startsWith('tpub')).toBe(true);
    expect(accountXpub('xna-legacy', MNEMONIC).xpub.startsWith('xpub')).toBe(true);
  });

  it('changes with the passphrase', () => {
    expect(accountXpub('xna-test', MNEMONIC, 'x').xpub).not.toBe(accountXpub('xna-test', MNEMONIC).xpub);
  });

  it('derives, from the public half alone, the addresses the wallet uses', () => {
    for (const [network, purpose] of [
      ['xna-legacy-test', 44],
      ['xna-test', 84],
    ] as const) {
      const shared = accountXpub(network, MNEMONIC);
      const account = getHDKey(network, MNEMONIC).derive(shared.path);
      // What a site holds: chain code and public key, no private key.
      const watchOnly = new HDKey(
        account.versions,
        account.chainCode,
        account.publicKey,
        undefined,
        account.depth,
        account.index,
        account.parentFingerprint,
      );
      expect(watchOnly.publicExtendedKey).toBe(shared.xpub);
      for (const index of [0, 1, 5]) {
        const pair = getAddressPair(network, MNEMONIC, 0, index) as unknown as {
          external: { address: string; path: string };
          internal: { address: string };
        };
        expect(pair.external.path).toBe(`m/${purpose}'/1'/0'/0/${index}`);
        expect(publicKeyToAddress(network, watchOnly.deriveChild(0).deriveChild(index).publicKey)).toBe(pair.external.address);
        expect(publicKeyToAddress(network, watchOnly.deriveChild(1).deriveChild(index).publicKey)).toBe(pair.internal.address);
      }
    }
  });
});
