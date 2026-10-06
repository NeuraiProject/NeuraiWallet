/**
 * Privacy pool transactions of each wallet, for the transaction list.
 *
 * The wallet history comes from address deltas, which say nothing about the
 * pool, so the app records the kind of every pool transaction it learns about:
 * the operations of an opened private wallet journal and the coins it publishes
 * for the pool (funding coins, sponsor sweeps). Kept per wallet in
 * AsyncStorage; losing it only drops the icons.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

export type PrivacyTxKind = 'deposit' | 'withdraw' | 'other';

export const PRIVACY_TX_TAGS_PREFIX = 'neurai_privacy_tx_tags_v1_';

/** Oldest tags are dropped beyond this many per wallet. */
const MAX_TAGS = 2000;
const TXID = /^[0-9a-f]{64}$/;
const KINDS: readonly PrivacyTxKind[] = ['deposit', 'withdraw', 'other'];

const tags = new Map<string, Record<string, PrivacyTxKind>>();
const loads = new Map<string, Promise<void>>();
const writes = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Transaction-list kind of a C6 journal action. */
export const privacyTxKind = (action: string): PrivacyTxKind =>
  action === 'deposit' ? 'deposit' : action === 'withdraw' ? 'withdraw' : 'other';

function parse(raw: string | null): Record<string, PrivacyTxKind> {
  const out: Record<string, PrivacyTxKind> = {};
  if (!raw) return out;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return out;
    for (const [txid, kind] of Object.entries(value)) {
      if (TXID.test(txid) && KINDS.includes(kind as PrivacyTxKind)) out[txid] = kind as PrivacyTxKind;
    }
  } catch {
    // A damaged entry only loses the icons.
  }
  return out;
}

function load(walletId: string): Promise<void> {
  let pending = loads.get(walletId);
  if (!pending) {
    pending = AsyncStorage.getItem(PRIVACY_TX_TAGS_PREFIX + walletId)
      .catch(() => null)
      .then(raw => {
        tags.set(walletId, { ...parse(raw), ...tags.get(walletId) });
        emit();
      });
    loads.set(walletId, pending);
  }
  return pending;
}

/** Each write stores the latest tags, so writes finishing out of order lose nothing. */
function persist(walletId: string): Promise<void> {
  const next = (writes.get(walletId) ?? Promise.resolve())
    .then(() => AsyncStorage.setItem(PRIVACY_TX_TAGS_PREFIX + walletId, JSON.stringify(tags.get(walletId) ?? {})))
    .catch(() => undefined);
  writes.set(walletId, next);
  return next;
}

/** Record pool transactions of `walletId`; invalid txids are ignored. Never rejects. */
export async function tagPrivacyTxs(walletId: string, entries: Array<[string | null | undefined, PrivacyTxKind]>): Promise<void> {
  if (!walletId) return;
  await load(walletId);
  const current = tags.get(walletId) ?? {};
  const fresh = entries.filter((entry): entry is [string, PrivacyTxKind] => TXID.test(entry[0] ?? '') && current[entry[0]!] !== entry[1]);
  if (!fresh.length) return;
  const next = { ...current, ...Object.fromEntries(fresh) };
  const txids = Object.keys(next);
  for (const txid of txids.slice(0, Math.max(0, txids.length - MAX_TAGS))) delete next[txid];
  tags.set(walletId, next);
  emit();
  await persist(walletId);
}

/** Pool kind of a wallet transaction, once known. */
export function usePrivacyTxKind(walletId: string, txid: string): PrivacyTxKind | undefined {
  useEffect(() => {
    if (walletId) load(walletId);
  }, [walletId]);
  return useSyncExternalStore(subscribe, () => tags.get(walletId)?.[txid]);
}
