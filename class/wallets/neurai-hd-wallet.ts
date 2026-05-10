/**
 * HD Neurai wallet (legacy ECDSA).
 *
 * Networks: `xna` (mainnet) and `xna-test` (testnet). Addresses are
 * Base58Check, prefix `N...` on mainnet and `t...` on testnet (per Neurai
 * `chainparams.cpp`). Derivation is BIP44 with coin type 1900 / 1.
 *
 * Sweep from external WIF is supported on legacy chains; for PQ use
 * `NeuraiPQWallet`, which forbids it.
 */

import { chainFor, NeuraiNetwork, WalletKind } from '../../blue_modules/neurai';
import { AbstractNeuraiWallet } from './abstract-neurai-wallet';

export class NeuraiHDWallet extends AbstractNeuraiWallet {
  static readonly type = 'NeuraiHD';
  static readonly typeReadable = 'Neurai HD';
  // @ts-ignore: override
  public readonly type = NeuraiHDWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = NeuraiHDWallet.typeReadable;

  constructor() {
    super();
    this.network = chainFor('testnet', 'legacy');
  }

  get walletKind(): WalletKind {
    return 'legacy';
  }

  /**
   * Sweep all UTXOs held by an external WIF private key into this wallet.
   *
   * @param wif external secp256k1 private key in Wallet Import Format
   * @param broadcast when true, the engine signs and submits the transaction
   * @returns the engine's `SweepResult` (txid, raw tx, inputs, outputs...)
   */
  async sweep(wif: string, broadcast: boolean): Promise<unknown> {
    const engine = await this.ensureEngine();
    return engine.sweep(wif, broadcast);
  }

  allowSweepFromWif(): boolean {
    return true;
  }

  /** Convenience constructor used by the Add Wallet flow. */
  static forNetwork(network: NeuraiNetwork, mnemonic: string, passphrase = ''): NeuraiHDWallet {
    const wallet = new NeuraiHDWallet();
    wallet.setSecret(mnemonic);
    wallet.setPassphrase(passphrase);
    wallet.setNetwork(chainFor(network, 'legacy'));
    return wallet;
  }
}
