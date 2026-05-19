/**
 * Public surface of the Neurai network layer.
 *
 * Pick a backend with `createBackend(config)`. Default is WSS; RPC remains
 * available as an explicit fallback. ElectrumX is a stub today and will throw
 * on every call other than `ping()`.
 */

import { AddressDelta, BackendConfig, FeeEstimate, MempoolEntry, NeuraiBackend, NeuraiUtxo } from './NeuraiBackend';
import { CHAIN_PARAMS, NeuraiChainType, NeuraiNetwork, WalletKind, chainFor } from './networkConfig';
import { ElectrumXBackend } from './ElectrumXBackend';
import { RpcBackend } from './RpcBackend';
import { WssBackend } from './WssBackend';
import { getWssUrlOverride } from './backendOverrides';

export * from './networkConfig';
export * from './NeuraiBackend';
export { WssBackend } from './WssBackend';
export { RpcBackend } from './RpcBackend';
export { ElectrumXBackend } from './ElectrumXBackend';
export { loadOverrides, getWssUrlOverride, setWssUrlOverride, isOverridesLoaded } from './backendOverrides';

/**
 * Temporary kill-switch: while the Neurai mainnet wallet-services WSS
 * deployment is not yet live, mainnet wallets must not try to talk to it —
 * otherwise every balance/history refresh throws and pollutes the UI.
 * Flip to `false` once `wallet-main-wss.neurai.org` is up.
 */
const MAINNET_BACKEND_DISABLED = false;

/** Inert backend: returns empty data, no network calls, no errors. Used to
 * neuter mainnet wallets while the mainnet WSS service is not yet deployed. */
class DisabledBackend implements NeuraiBackend {
  readonly kind: 'wss' = 'wss';
  readonly chain: NeuraiChainType;
  constructor(chain: NeuraiChainType) {
    this.chain = chain;
  }
  async rpc<T = unknown>(): Promise<T> {
    throw new Error(`Neurai ${this.chain} backend is temporarily disabled (mainnet WSS not deployed)`);
  }
  async getTipHeight(): Promise<number> {
    return 0;
  }
  async getBalance(): Promise<number> {
    return 0;
  }
  async getAddressHistory(): Promise<AddressDelta[]> {
    return [];
  }
  async getUtxos(): Promise<NeuraiUtxo[]> {
    return [];
  }
  async getMempool(): Promise<MempoolEntry[]> {
    return [];
  }
  async broadcast(): Promise<string> {
    throw new Error(`Neurai ${this.chain} backend is temporarily disabled (mainnet WSS not deployed)`);
  }
  async estimateFee(targetBlocks: number): Promise<FeeEstimate> {
    return { targetBlocks, feeRateXnaPerKb: 0 };
  }
  async getBlockTimes(): Promise<Record<number, number>> {
    return {};
  }
  async ping(): Promise<boolean> {
    return false;
  }
}

export function createBackend(config: BackendConfig): NeuraiBackend {
  switch (config.kind) {
    case 'wss':
      return new WssBackend(config);
    case 'rpc':
      return new RpcBackend(config);
    case 'electrumx':
      return new ElectrumXBackend(config);
  }
}

/**
 * Convenience: build the default backend straight from `(network, kind)`,
 * using neurai-wallet-services over WSS. Mainnet falls back to an inert
 * backend while the mainnet WSS service is not yet deployed (see
 * `MAINNET_BACKEND_DISABLED`).
 */
export function createDefaultBackend(network: NeuraiNetwork, kind: WalletKind): NeuraiBackend {
  const chain: NeuraiChainType = chainFor(network, kind);
  if (MAINNET_BACKEND_DISABLED && network === 'mainnet') {
    return new DisabledBackend(chain);
  }
  const params = CHAIN_PARAMS[chain];
  return createBackend({
    kind: 'wss',
    chain,
    url: getWssUrlOverride(network) ?? params.defaultWssUrl,
    authToken: params.defaultWssAuthToken,
  });
}

export function createDefaultWssBackend(network: NeuraiNetwork, kind: WalletKind): NeuraiBackend {
  return createDefaultBackend(network, kind);
}

/** Explicit fallback for a direct full-node JSON-RPC backend. */
export function createDefaultRpcBackend(network: NeuraiNetwork, kind: WalletKind): NeuraiBackend {
  const chain: NeuraiChainType = chainFor(network, kind);
  return createBackend({
    kind: 'rpc',
    chain,
    url: CHAIN_PARAMS[chain].defaultRpcUrl,
  });
}
