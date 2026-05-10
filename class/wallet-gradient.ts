/**
 * Wallet card gradients. Only Neurai HD (legacy ECDSA) and Neurai PQ
 * (post-quantum) survive after the Bitcoin classes were removed.
 */
import { NeuraiHDWallet } from './wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from './wallets/neurai-pq-wallet';

export default class WalletGradient {
  static defaultGradients: string[] = ['#B770F6', '#9013FE'];
  static neuraiHDWallet: string[] = ['#42E695', '#3BB2B8'];
  static neuraiPQWallet: string[] = ['#7F00FF', '#E100FF'];

  static createWallet = () => WalletGradient.defaultGradients[0];

  static gradientsFor(type: string): string[] {
    switch (type) {
      case NeuraiHDWallet.type:
        return WalletGradient.neuraiHDWallet;
      case NeuraiPQWallet.type:
        return WalletGradient.neuraiPQWallet;
      default:
        return WalletGradient.defaultGradients;
    }
  }

  static headerColorFor(type: string): string {
    return WalletGradient.gradientsFor(type)[0];
  }
}
