/**
 * Wallet card gradients. Only Neurai HD (legacy ECDSA) and Neurai PQ
 * (post-quantum) survive after the Bitcoin classes were removed.
 */
import { NeuraiHDWallet } from './wallets/neurai-hd-wallet';
import { NeuraiPQWallet } from './wallets/neurai-pq-wallet';

export default class WalletGradient {
  // Wallet card gradients in the Neurai orange family.
  // Legacy HD wallets get a warmer, lighter orange (Tailwind orange-400 →
  // orange-500); PQ wallets get a deeper, darker amber so the two kinds are
  // visually distinguishable while still feeling like the same brand.
  static defaultGradients: string[] = ['#fb923c', '#f97316'];
  static neuraiHDWallet: string[] = ['#fb923c', '#f97316'];
  static neuraiPQWallet: string[] = ['#ea580c', '#c2410c'];

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
