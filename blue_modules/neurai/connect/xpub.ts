/**
 * `neurai_getAccountXpub` for Neurai Connect: the extended public key of the
 * wallet's account, so a site can see every address of it — receive and
 * change — instead of the one address the session exposes.
 *
 * It is the ACCOUNT key (`m/44'/coin'/0'` for Legacy, `m/84'/coin'/0'` for
 * ECDSA witness v3), never the master key: from the master public key every
 * account of the seed could be followed, while the account key covers exactly
 * the addresses this wallet uses. Its children `0/i` (receive) and `1/i`
 * (change) are the addresses the wallet derives (`neurai-jswallet`, account 0).
 *
 * Sharing it reveals the history and balance of the whole account; it does
 * not allow spending. That is why it is a request the user approves, not
 * something every session gets.
 *
 * Post-quantum wallets have no such key (their tree is hardened at every
 * level) and hardware wallets sign with one fixed key, so neither answers.
 *
 * Only package imports, so the module can be loaded outside the app.
 */

import { getCoinType, getHDKey } from '@neuraiproject/neurai-key';

/** neurai-key 5 networks with a secp256k1 HD tree (see keyNetwork.ts). */
export type XpubKeyNetwork = 'xna-legacy' | 'xna-legacy-test' | 'xna' | 'xna-test';

export interface ConnectAccountXpub {
  /** Extended public key of the account (`xpub…` mainnet, `tpub…` testnet). */
  xpub: string;
  /** Path of the account key from the master: its children are `0/i` and `1/i`. */
  path: string;
  /** How the children are encoded: Base58 P2PKH, or strict ECDSA witness v3. */
  addressType: 'legacy' | 'ecdsa';
}

/** Account 0, as the wallet engine derives it. */
export const CONNECT_XPUB_ACCOUNT = 0;

/**
 * The account extended public key for a mnemonic on a neurai-key 5 network.
 * `xna` / `xna-test` are the ECDSA witness v3 tree (`m/84'`); the `*-legacy`
 * networks the Legacy one (`m/44'`).
 */
export function accountXpub(keyNetwork: XpubKeyNetwork, mnemonic: string, passphrase = ''): ConnectAccountXpub {
  const ecdsa = keyNetwork === 'xna' || keyNetwork === 'xna-test';
  const purpose = ecdsa ? 84 : 44;
  const path = `m/${purpose}'/${getCoinType(keyNetwork)}'/${CONNECT_XPUB_ACCOUNT}'`;
  const xpub = getHDKey(keyNetwork, mnemonic, passphrase).derive(path).publicExtendedKey;
  return { xpub, path, addressType: ecdsa ? 'ecdsa' : 'legacy' };
}
