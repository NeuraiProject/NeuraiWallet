/**
 * DePIN uses the selected wallet WSS endpoint. Legacy RPC preferences remain
 * readable for compatibility, but do not select a transport or receive traffic.
 * Pool-key trust is keyed by the effective WSS URL, never by obsolete HTTP URLs.
 */

import DefaultPreference from 'react-native-default-preference';

import { GROUP_IO_BLUEWALLET } from '../currency';
import { CHAIN_PARAMS, chainFor, type NeuraiNetwork } from './networkConfig';
import { getWssUrlOverride, loadOverrides } from './backendOverrides';

export interface DepinRpcConfig {
  url: string;
  username?: string;
  password?: string;
}

const KEY_BY_NETWORK: Record<NeuraiNetwork, string> = {
  mainnet: 'NEURAI_DEPIN_RPC_MAINNET',
  testnet: 'NEURAI_DEPIN_RPC_TESTNET',
};

/** Public DePIN-enabled defaults (same as the Neurai web wallet). */
export const DEFAULT_DEPIN_RPC_URL: Record<NeuraiNetwork, string> = {
  mainnet: CHAIN_PARAMS.xna.defaultWssUrl,
  testnet: CHAIN_PARAMS['xna-test'].defaultWssUrl,
};

const cache = new Map<NeuraiNetwork, DepinRpcConfig>();
let loaded = false;
let loading: Promise<void> | null = null;

function parseConfig(raw: string | null): DepinRpcConfig | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const obj = JSON.parse(raw) as Partial<DepinRpcConfig>;
    if (obj && typeof obj.url === 'string' && obj.url.length > 0) {
      return {
        url: obj.url,
        username: typeof obj.username === 'string' && obj.username.length > 0 ? obj.username : undefined,
        password: typeof obj.password === 'string' && obj.password.length > 0 ? obj.password : undefined,
      };
    }
  } catch {
    // Legacy/plain string value: treat it as a bare URL.
    if (/^https?:\/\//i.test(raw)) return { url: raw };
  }
  return undefined;
}

async function load(): Promise<void> {
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  for (const network of Object.keys(KEY_BY_NETWORK) as NeuraiNetwork[]) {
    const value = (await DefaultPreference.get(KEY_BY_NETWORK[network])) as string | null;
    const cfg = parseConfig(value);
    if (cfg) cache.set(network, cfg);
  }
  loaded = true;
}

export function loadDepinRpcOverrides(): Promise<void> {
  if (!loading) loading = Promise.all([load(), loadOverrides()]).then(() => undefined);
  return loading;
}

export function isDepinRpcOverridesLoaded(): boolean {
  return loaded;
}

/** User override for a network, or undefined if none set. */
export function getDepinRpcOverride(network: NeuraiNetwork): DepinRpcConfig | undefined {
  return cache.get(network);
}

/** Effective endpoint shared with the wallet, including custom WSS settings. */
export function getDepinRpcConfig(network: NeuraiNetwork): DepinRpcConfig {
  // Old HTTP preferences remain stored for recovery but are never contacted.
  return { url: getWssUrlOverride(network) ?? CHAIN_PARAMS[chainFor(network, 'legacy')].defaultWssUrl };
}

/** Persist (or clear, when `config` is null) the DePIN RPC config for a network. */
export async function setDepinRpcConfig(network: NeuraiNetwork, config: DepinRpcConfig | null): Promise<void> {
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  const key = KEY_BY_NETWORK[network];
  const url = (config?.url ?? '').trim();
  if (url.length === 0) {
    await DefaultPreference.clear(key);
    cache.delete(network);
    return;
  }
  const normalized: DepinRpcConfig = {
    url,
    username: config?.username?.trim() || undefined,
    password: config?.password?.trim() || undefined,
  };
  await DefaultPreference.set(key, JSON.stringify(normalized));
  cache.set(network, normalized);
}

// Warm the cache at import. Sync reads fall back to the public default until
// this resolves; legacy HTTP settings remain stored but inactive.
loadDepinRpcOverrides().catch(() => {
  // Storage errors are non-fatal; defaults will be used.
});
