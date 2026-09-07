/**
 * "Has this wallet's DePIN address published its public key?" — the on-chain
 * fact behind the DePIN badge on the wallet card.
 *
 * A reveal is a burn transaction: once it is on the chain it never comes back,
 * so a `true` is stored for good and never asked again. Anything else is
 * re-checked, but throttled and shared per wallet, so ten cards or a burst of
 * re-renders cost one `getpubkey` at most per minute.
 *
 * Keyed by wallet id rather than address so the settled case needs no key
 * derivation at all: the card only derives the DePIN address for wallets whose
 * reveal is still unknown.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseRevealed } from '../../components/depinChat/utils';
import { getDepinRpcBackend, loadDepinRpcOverrides } from './index';
import type { NeuraiNetwork } from './networkConfig';

const REVEALED_PREFIX = 'depin_revealed_';
/** Between checks of a wallet that is not (yet) revealed. */
const RECHECK_MS = 60_000;

const revealed = new Set<string>();
const storageLoads = new Map<string, Promise<void>>();
const lastChecked = new Map<string, number>();
const inFlight = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach(cb => cb());

export function isKnownRevealed(walletID: string): boolean {
  return revealed.has(walletID);
}

/** Settles the question for good; safe to call repeatedly. */
export function markRevealed(walletID: string): void {
  if (revealed.has(walletID)) return;
  revealed.add(walletID);
  AsyncStorage.setItem(REVEALED_PREFIX + walletID, '1').catch(() => {});
  notify();
}

export function subscribeRevealed(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function loadFromStorage(walletID: string): Promise<void> {
  const pending = storageLoads.get(walletID);
  if (pending) return pending;
  const load = AsyncStorage.getItem(REVEALED_PREFIX + walletID)
    .then(value => {
      if (value === '1' && !revealed.has(walletID)) {
        revealed.add(walletID);
        notify();
      }
    })
    .catch(() => {});
  storageLoads.set(walletID, load);
  return load;
}

/**
 * Resolves whether the wallet is revealed, asking the node only when the
 * answer is not already settled and the last ask is older than RECHECK_MS.
 * `address` is only needed for that ask, so callers may pass null once they
 * have nothing to derive it from (hardware wallets without their device).
 */
export async function ensureRevealed(walletID: string, address: string | null, network: NeuraiNetwork): Promise<boolean> {
  await loadFromStorage(walletID);
  if (revealed.has(walletID)) return true;
  if (!address) return false;

  const pending = inFlight.get(walletID);
  if (pending) return pending;
  if (Date.now() - (lastChecked.get(walletID) ?? 0) < RECHECK_MS) return false;

  const check = (async () => {
    try {
      await loadDepinRpcOverrides();
      const response = await getDepinRpcBackend(network).rpc('getpubkey', [address]);
      if (parseRevealed(response) === true) {
        markRevealed(walletID);
        return true;
      }
    } catch {
      // Node unreachable: unknown stays unknown, the next tick asks again.
    } finally {
      lastChecked.set(walletID, Date.now());
      inFlight.delete(walletID);
    }
    return false;
  })();
  inFlight.set(walletID, check);
  return check;
}
