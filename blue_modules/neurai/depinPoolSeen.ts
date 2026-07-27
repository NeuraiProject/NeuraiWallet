/**
 * Tracks how much of a DePIN channel the user has already seen, so the wallet
 * can show a "new activity" marker without decrypting anything.
 *
 * `depinpoolstats` is the one DePIN call that is never privacy-wrapped: it
 * reports the pool's message count and newest timestamp in the clear. That is
 * enough to tell that the channel moved — no identity, no device, no signature,
 * so a background check costs one small HTTP request and never wakes the
 * hardware wallet.
 *
 * What it cannot tell is whether the new traffic is addressed to *you*: only
 * decryption answers that, and that is exactly the work we are avoiding here.
 * The marker therefore means "this channel has new messages", which may include
 * messages you will not be able to read.
 *
 * The signature is stored per network (the pool belongs to the configured node,
 * not to an address), so it works before any wallet identity is available.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NeuraiNetwork } from './networkConfig';

const KEY_PREFIX = 'depin_pool_seen_';

type Listener = () => void;
const listeners = new Set<Listener>();
/** In-memory mirror so reads are synchronous after the first hydration. */
const seen = new Map<NeuraiNetwork, string>();

/** Fingerprint of a pool state: `total_messages|newest_message`. */
export const poolSignature = (stats: { total_messages?: unknown; newest_message?: unknown } | null | undefined): string =>
  `${String(stats?.total_messages ?? '')}|${String(stats?.newest_message ?? '')}`;

/** An empty pool answer carries no information — do not treat it as a state. */
export const isMeaningfulSignature = (signature: string): boolean => signature !== '|';

export async function loadSeenSignature(network: NeuraiNetwork): Promise<string | null> {
  if (seen.has(network)) return seen.get(network) ?? null;
  try {
    const stored = await AsyncStorage.getItem(KEY_PREFIX + network);
    if (stored) seen.set(network, stored);
    return stored;
  } catch {
    return null;
  }
}

export function getSeenSignature(network: NeuraiNetwork): string | null {
  return seen.get(network) ?? null;
}

/** Record the channel as read up to this pool state and wake any watcher. */
export function markPoolSeen(network: NeuraiNetwork, signature: string): void {
  if (!isMeaningfulSignature(signature) || seen.get(network) === signature) return;
  seen.set(network, signature);
  AsyncStorage.setItem(KEY_PREFIX + network, signature).catch(() => {});
  listeners.forEach(listener => listener());
}

export function subscribePoolSeen(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
