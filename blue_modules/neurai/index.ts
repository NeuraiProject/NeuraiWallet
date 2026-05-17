/**
 * Public surface of the Neurai network layer.
 *
 * Pick a backend with `createBackend(config)`. Default is WSS; RPC remains
 * available as an explicit fallback. ElectrumX is a stub today and will throw
 * on every call other than `ping()`.
 */

import { ElectrumXBackend } from './ElectrumXBackend';
import { BackendConfig, NeuraiBackend } from './NeuraiBackend';
import { CHAIN_PARAMS, NeuraiChainType, NeuraiNetwork, WalletKind, chainFor } from './networkConfig';
import { RpcBackend } from './RpcBackend';
import { WssBackend } from './WssBackend';

export * from './networkConfig';
export * from './NeuraiBackend';
export { WssBackend } from './WssBackend';
export { RpcBackend } from './RpcBackend';
export { ElectrumXBackend } from './ElectrumXBackend';

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
 * using neurai-wallet-services over WSS.
 */
export function createDefaultBackend(network: NeuraiNetwork, kind: WalletKind): NeuraiBackend {
  const chain: NeuraiChainType = chainFor(network, kind);
  const params = CHAIN_PARAMS[chain];
  return createBackend({
    kind: 'wss',
    chain,
    url: params.defaultWssUrl,
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
