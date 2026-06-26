/**
 * User configuration for the DePIN chat RPC endpoint, per network.
 *
 * DePIN chat talks to a node that has DePIN messaging enabled (RPC methods
 * `depinsubmitmsg` / `depinreceivemsg` / `checkdepinvalidity` …). That node is
 * NOT necessarily the same as the wallet's balance/history backend, and each
 * operator runs their own — so the chat RPC is configured separately here.
 *
 * Stored with DefaultPreference (same namespace as the rest of the app). Reads
 * are sync against an in-memory cache populated at module init; writes update
 * both the cache and the persisted store. A self-hosted node may require RPC
 * credentials, so an optional username/password is supported alongside the URL.
 *
 * Mirrors the pattern in `backendOverrides.ts`.
 */

import DefaultPreference from 'react-native-default-preference';

import { GROUP_IO_BLUEWALLET } from '../currency';
import type { NeuraiNetwork } from './networkConfig';

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
  mainnet: 'https://rpc-depin.neurai.org/rpc',
  testnet: 'https://rpc-testnet.neurai.org/rpc',
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
  if (!loading) loading = load();
  return loading;
}

export function isDepinRpcOverridesLoaded(): boolean {
  return loaded;
}

/** User override for a network, or undefined if none set. */
export function getDepinRpcOverride(network: NeuraiNetwork): DepinRpcConfig | undefined {
  return cache.get(network);
}

/** Effective config: user override if present, else the public DePIN default. */
export function getDepinRpcConfig(network: NeuraiNetwork): DepinRpcConfig {
  return cache.get(network) ?? { url: DEFAULT_DEPIN_RPC_URL[network] };
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
// this resolves; after that, saved overrides are honoured.
loadDepinRpcOverrides().catch(() => {
  // Storage errors are non-fatal; defaults will be used.
});
