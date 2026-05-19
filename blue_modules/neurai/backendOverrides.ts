/**
 * User overrides for the Neurai WSS backend URL, per network.
 *
 * Persisted with DefaultPreference (same namespace as the rest of the app).
 * Reads are sync against an in-memory cache populated at module init; writes
 * update both the cache and the persisted store. Existing wallets cache their
 * backend instance, so a URL change only takes effect for backends created
 * after the change — typically that means restarting the wallet flow or the
 * app.
 */

import DefaultPreference from 'react-native-default-preference';
import { GROUP_IO_BLUEWALLET } from '../currency';
import type { NeuraiNetwork } from './networkConfig';

const KEY_BY_NETWORK: Record<NeuraiNetwork, string> = {
  mainnet: 'NEURAI_WSS_MAINNET_URL',
  testnet: 'NEURAI_WSS_TESTNET_URL',
};

const cache = new Map<NeuraiNetwork, string>();
let loaded = false;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  for (const network of Object.keys(KEY_BY_NETWORK) as NeuraiNetwork[]) {
    const value = (await DefaultPreference.get(KEY_BY_NETWORK[network])) as string | null;
    if (typeof value === 'string' && value.length > 0) cache.set(network, value);
  }
  loaded = true;
}

export function loadOverrides(): Promise<void> {
  if (!loading) loading = load();
  return loading;
}

export function getWssUrlOverride(network: NeuraiNetwork): string | undefined {
  return cache.get(network);
}

export function isOverridesLoaded(): boolean {
  return loaded;
}

export async function setWssUrlOverride(network: NeuraiNetwork, url: string | null): Promise<void> {
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  const key = KEY_BY_NETWORK[network];
  const trimmed = (url ?? '').trim();
  if (trimmed.length === 0) {
    await DefaultPreference.clear(key);
    cache.delete(network);
    return;
  }
  await DefaultPreference.set(key, trimmed);
  cache.set(network, trimmed);
}

// Kick off the first read at module import. Reads from createDefaultBackend
// are sync and will see the cache once it resolves; until then they fall back
// to the compiled-in default — which is the same value as a "no override"
// state, so there is no incorrect state, only a brief window where a freshly
// installed app cannot honour a saved override until the cache fills. After
// that first promise resolves, all subsequent backend creations honour it.
loadOverrides().catch(() => {
  // Storage errors are non-fatal; defaults will be used.
});
