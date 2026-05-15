/**
 * Wallet card gradients. Colour is keyed off the wallet's chain
 * (mainnet/testnet) so the user can tell at a glance which network a wallet
 * belongs to — the PQ-vs-legacy distinction is already conveyed by other
 * affordances (badge label, send/receive flows).
 */
import { isTestnetChain, type NeuraiChainType } from '../blue_modules/neurai/networkConfig';

type WalletLike = { network?: NeuraiChainType } | undefined | null;

export default class WalletGradient {
  // Mainnet uses the lighter Neurai orange (Tailwind orange-400 → orange-500).
  // Testnet uses a deeper amber so the two networks are visually distinct.
  static defaultGradients: string[] = ['#fb923c', '#f97316'];
  static mainnetGradient: string[] = ['#fb923c', '#f97316'];
  static testnetGradient: string[] = ['#ea580c', '#c2410c'];

  static createWallet = () => WalletGradient.defaultGradients[0];

  static gradientsForChain(chain?: NeuraiChainType | null): string[] {
    return chain && isTestnetChain(chain) ? WalletGradient.testnetGradient : WalletGradient.mainnetGradient;
  }

  static gradientsForWallet(wallet: WalletLike): string[] {
    return WalletGradient.gradientsForChain(wallet?.network);
  }

  static headerColorForChain(chain?: NeuraiChainType | null): string {
    return WalletGradient.gradientsForChain(chain)[0];
  }

  static headerColorForWallet(wallet: WalletLike): string {
    return WalletGradient.gradientsForWallet(wallet)[0];
  }
}
