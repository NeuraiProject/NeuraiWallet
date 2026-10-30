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

import { deriveKeysFromMnemonic } from '@neuraiproject/neurai-silent-payments';
import { chainFor, NeuraiChainType, NeuraiNetwork, WalletKind } from '../../blue_modules/neurai';
import { silentPaymentNetworkFor } from '../../blue_modules/neurai/silentPayments';
import { AbstractNeuraiWallet } from './abstract-neurai-wallet';

type SilentPaymentCodeCache = { network: NeuraiChainType; secret: string; passphrase: string; code: string };

export class NeuraiECDSAWallet extends AbstractNeuraiWallet {
  static readonly type = 'NeuraiECDSA';
  static readonly typeReadable = 'Neurai ECDSA';
  // @ts-ignore: override
  public readonly type = NeuraiECDSAWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = NeuraiECDSAWallet.typeReadable;

  /** Derived payment code and what it was derived from. Not persisted. */
  private _silentPaymentCode: SilentPaymentCodeCache | null;

  constructor() {
    super();
    this.network = chainFor('testnet', 'ecdsa');
    this._silentPaymentCode = null;
    Object.defineProperty(this, '_silentPaymentCode', { writable: true, enumerable: false, value: null });
  }

  get walletKind(): WalletKind {
    return 'ecdsa';
  }

  /**
   * NIP-047 silent payment code (`nsp1…` / `tnsp1…`) of this wallet's words
   * and passphrase: the same code the node's `-addresstype=ecdsa` wallet shows
   * for that seed. Every payment to it arrives at a new strict ECDSA v3
   * address. The derivation runs PBKDF2 on the JS thread, so the result is
   * kept for the session.
   */
  getSilentPaymentCode(): string {
    const cached = this._silentPaymentCode;
    if (cached && cached.network === this.network && cached.secret === this.secret && cached.passphrase === this.passphrase) {
      return cached.code;
    }
    const keys = deriveKeysFromMnemonic(this.secret, this.passphrase, silentPaymentNetworkFor(this.network));
    keys.scanPrivateKey.fill(0);
    keys.spendPrivateKey.fill(0);
    this._silentPaymentCode = { network: this.network, secret: this.secret, passphrase: this.passphrase, code: keys.code };
    return keys.code;
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
