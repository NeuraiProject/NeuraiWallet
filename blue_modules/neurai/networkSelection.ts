/**
 * Home-screen network selection.
 *
 * The wallet list shows one network at a time — Mainnet or Testnet — picked
 * from a switcher in the header. This module holds the parts of that decision
 * that do not touch React: which network a wallet belongs to, which network is
 * actually shown given what the user picked and what wallets exist, and how to
 * tell that a wallet on the network the user is *not* looking at received
 * coins, which is what lights the dot on the switcher.
 */
import type { NeuraiNetwork } from './networkConfig';

export const DEFAULT_SELECTED_NETWORK: NeuraiNetwork = 'mainnet';

export const NETWORKS: readonly NeuraiNetwork[] = ['mainnet', 'testnet'];

export function otherNetwork(network: NeuraiNetwork): NeuraiNetwork {
  return network === 'mainnet' ? 'testnet' : 'mainnet';
}

/**
 * Structural stand-in for a wallet: only Neurai wallets carry
 * `getNeuraiNetwork`, so its presence is the type test, and tests can pass
 * plain objects instead of constructing wallet classes.
 */
export interface NetworkWalletLike {
  getID(): string;
  getNeuraiNetwork?: () => NeuraiNetwork;
  getTransactions(): ReadonlyArray<{ value?: number }>;
}

/**
 * Which network a wallet belongs to. Anything that is not a Neurai wallet is
 * bucketed as mainnet — the same convention the total balance uses, so no XNA
 * silently drops out of view.
 */
export function walletNetwork(wallet: Pick<NetworkWalletLike, 'getNeuraiNetwork'>): NeuraiNetwork {
  return typeof wallet.getNeuraiNetwork === 'function' ? wallet.getNeuraiNetwork() : 'mainnet';
}

export interface NetworkView {
  /** The network actually shown. */
  network: NeuraiNetwork;
  /** True only when both networks have wallets — otherwise a switcher is noise. */
  canSwitch: boolean;
}

/**
 * The user's pick wins while it has wallets. With wallets on only one network
 * that network is shown regardless of the pick (deleting the last testnet
 * wallet must not strand the user on an empty testnet page). With no wallets
 * at all the page is mainnet, so a first-time user creates real-money wallets
 * unless they deliberately choose otherwise.
 */
export function resolveNetworkView(
  selected: NeuraiNetwork,
  wallets: ReadonlyArray<Pick<NetworkWalletLike, 'getNeuraiNetwork'>>,
): NetworkView {
  let hasMainnet = false;
  let hasTestnet = false;
  for (const wallet of wallets) {
    if (walletNetwork(wallet) === 'testnet') hasTestnet = true;
    else hasMainnet = true;
  }
  const canSwitch = hasMainnet && hasTestnet;
  if (canSwitch) return { network: selected, canSwitch };
  if (hasTestnet) return { network: 'testnet', canSwitch };
  return { network: 'mainnet', canSwitch };
}

/** Received transactions only: a send from the other network is the user's own doing and needs no reminder. */
export function incomingTxCount(txs: ReadonlyArray<{ value?: number }>): number {
  let count = 0;
  for (const tx of txs) if ((tx.value ?? 0) > 0) count++;
  return count;
}

export interface IncomingActivity {
  /** Per-wallet incoming count to carry into the next comparison. */
  next: Map<string, number>;
  /** Networks where at least one wallet's incoming count went up. */
  networksWithNew: Set<NeuraiNetwork>;
}

/**
 * Compares the current wallets against the last snapshot of incoming counts.
 * A wallet absent from `prev` is baselined silently: a freshly imported wallet
 * brings its whole history along, and none of it is news.
 */
export function detectIncomingActivity(prev: ReadonlyMap<string, number>, wallets: ReadonlyArray<NetworkWalletLike>): IncomingActivity {
  const next = new Map<string, number>();
  const networksWithNew = new Set<NeuraiNetwork>();
  for (const wallet of wallets) {
    const id = wallet.getID();
    const count = incomingTxCount(wallet.getTransactions());
    next.set(id, count);
    const before = prev.get(id);
    if (before !== undefined && count > before) networksWithNew.add(walletNetwork(wallet));
  }
  return { next, networksWithNew };
}
