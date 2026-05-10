/**
 * Public surface of the Neurai network layer.
 *
 * Pick a backend with `createBackend(config)`. Default is RPC; ElectrumX is a
 * stub today and will throw on every call other than `ping()`.
 */

import { ElectrumXBackend } from './ElectrumXBackend';
import { BackendConfig, NeuraiBackend } from './NeuraiBackend';
import { CHAIN_PARAMS, NeuraiChainType, NeuraiNetwork, WalletKind, chainFor } from './networkConfig';
import { RpcBackend } from './RpcBackend';

export * from './networkConfig';
export * from './NeuraiBackend';
export { RpcBackend } from './RpcBackend';
export { ElectrumXBackend } from './ElectrumXBackend';

export function createBackend(config: BackendConfig): NeuraiBackend {
  switch (config.kind) {
    case 'rpc':
      return new RpcBackend(config);
    case 'electrumx':
      return new ElectrumXBackend(config);
  }
}

/**
 * Convenience: build a backend straight from `(network, kind)`, falling back
 * to the public default RPC URL for that chain.
 */
export function createDefaultRpcBackend(network: NeuraiNetwork, kind: WalletKind): NeuraiBackend {
  const chain: NeuraiChainType = chainFor(network, kind);
  return createBackend({
    kind: 'rpc',
    chain,
    url: CHAIN_PARAMS[chain].defaultRpcUrl,
  });
}
