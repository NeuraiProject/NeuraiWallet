/**
 * HD Neurai wallet with strict ECDSA witness v3 addresses.
 *
 * Networks: `xna-ecdsa` (mainnet) and `xna-ecdsa-test` (testnet). Addresses
 * are Bech32m witness v3, `nq1r…` on mainnet and `tnq1r…` on testnet, the
 * node's `getnewaddress "" ecdsa` type. The key is an ordinary compressed
 * secp256k1 key, like Legacy, under its own branch `m/84'/coin'/0'/{0,1}/i`
 * (coin type 1900 / 1), so the same words give different addresses than a
 * Legacy wallet. Spends are smaller than Legacy ones (about 70 vbytes per
 * input), and the node only accepts them where witness v3 is active: testnet
 * for now.
 */

import { chainFor, NeuraiNetwork, WalletKind } from '../../blue_modules/neurai';
import { AbstractNeuraiWallet } from './abstract-neurai-wallet';

export class NeuraiECDSAWallet extends AbstractNeuraiWallet {
  static readonly type = 'NeuraiECDSA';
  static readonly typeReadable = 'Neurai ECDSA';
  // @ts-ignore: override
  public readonly type = NeuraiECDSAWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = NeuraiECDSAWallet.typeReadable;

  constructor() {
    super();
    this.network = chainFor('testnet', 'ecdsa');
  }

  get walletKind(): WalletKind {
    return 'ecdsa';
  }

  /**
   * Sweep all UTXOs held by an external WIF private key into this wallet. The
   * engine collects the Legacy and the ECDSA witness v3 address of the key.
   */
  async sweep(wif: string, broadcast: boolean): Promise<unknown> {
    const engine = await this.ensureEngine();
    return engine.sweep(wif, broadcast);
  }

  allowSweepFromWif(): boolean {
    return true;
  }

  static forNetwork(network: NeuraiNetwork, mnemonic: string, passphrase = ''): NeuraiECDSAWallet {
    const wallet = new NeuraiECDSAWallet();
    wallet.setSecret(mnemonic);
    wallet.setPassphrase(passphrase);
    wallet.setNetwork(chainFor(network, 'ecdsa'));
    return wallet;
  }
}
