/**
 * PostQuantum Neurai wallet (ML-DSA-44).
 *
 * Networks: `xna-pq` (mainnet) and `xna-pq-test` (testnet). Mainnet addresses
 * are generic AuthScript witness v1 (`nc1p…`, the 4.x derivation). Testnet
 * addresses are the node's strict PQ witness v2 (`tpq1z…`), the type the C6
 * privacy pool accepts. Derivation is the native PQ HD tree
 * (`m_pq/100'/coin'/0'/0'/index'`), all levels hardened; both encodings share
 * the same key per index.
 *
 * PQ keys are not WIF-compatible; sweep from external private key is
 * disallowed (the engine throws if attempted).
 */

import { chainFor, NeuraiNetwork, WalletKind } from '../../blue_modules/neurai';
import { AbstractNeuraiWallet } from './abstract-neurai-wallet';

export class NeuraiPQWallet extends AbstractNeuraiWallet {
  static readonly type = 'NeuraiPQ';
  static readonly typeReadable = 'Neurai PostQuantum';
  // @ts-ignore: override
  public readonly type = NeuraiPQWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = NeuraiPQWallet.typeReadable;

  constructor() {
    super();
    this.network = chainFor('testnet', 'pq');
  }

  get walletKind(): WalletKind {
    return 'pq';
  }

  allowSweepFromWif(): boolean {
    return false;
  }

  static forNetwork(network: NeuraiNetwork, mnemonic: string, passphrase = ''): NeuraiPQWallet {
    const wallet = new NeuraiPQWallet();
    wallet.setSecret(mnemonic);
    wallet.setPassphrase(passphrase);
    wallet.setNetwork(chainFor(network, 'pq'));
    return wallet;
  }
}
