/**
 * ElectrumX backend for Neurai — SKELETON.
 *
 * This implementation is intentionally incomplete. We expose the full
 * `NeuraiBackend` surface so the rest of the app can already program against
 * it, but every method throws `NotImplementedError` until an ElectrumX server
 * for Neurai is available and the protocol is wired up.
 *
 * Reference for a future port:
 *   - BlueWallet's pre-fork BlueElectrum.ts (multiGetBalanceByAddress,
 *     multiGetHistoryByAddress, multiGetTransactionByTxid, broadcast, ping...)
 *     consult `git log -- blue_modules/BlueElectrum.ts`.
 *   - Neurai address-index RPC equivalents documented in
 *     `@neuraiproject/neurai-rpc/neurai_methods.md`.
 *
 * TODO(electrumx):
 *  - Open TCP/SSL socket via `react-native-tcp-socket`
 *  - Implement protocol handshake (`server.version`, `server.ping`)
 *  - Map calls:
 *      getBalance        -> blockchain.scripthash.get_balance
 *      getAddressHistory -> blockchain.scripthash.get_history
 *      getUtxos          -> blockchain.scripthash.listunspent
 *      getMempool        -> blockchain.scripthash.get_mempool
 *      broadcast         -> blockchain.transaction.broadcast
 *      estimateFee       -> blockchain.estimatefee
 *      getTipHeight      -> blockchain.headers.subscribe (height field)
 *  - Connection retry, peer rotation, batching (the BlueWallet client batches
 *    address calls; preserve that behaviour for performance).
 *  - Convert Neurai addresses to scripthashes (sha256 of the scriptPubKey,
 *    reversed) — Neurai uses Bitcoin-compatible script encoding for legacy
 *    addresses; PQ Bech32m AuthScript needs a separate path.
 */

import { AddressDelta, BackendConfig, FeeEstimate, MempoolEntry, NeuraiBackend, NeuraiUtxo, NotImplementedError } from './NeuraiBackend';
import type { NeuraiChainType } from './networkConfig';

export class ElectrumXBackend implements NeuraiBackend {
  readonly kind = 'electrumx' as const;
  readonly chain: NeuraiChainType;
  // Kept for the future implementation; suppress unused warnings without
  // adding runtime cost.
  private readonly config: Omit<BackendConfig, 'kind'>;

  constructor(config: Omit<BackendConfig, 'kind'>) {
    this.chain = config.chain;
    this.config = config;
  }

  rpc<T = unknown>(_method: string, _params: unknown[]): Promise<T> {
    return Promise.reject(new NotImplementedError('rpc', 'ElectrumX has no JSON-RPC passthrough'));
  }

  getTipHeight(): Promise<number> {
    throw new NotImplementedError('getTipHeight', 'wire blockchain.headers.subscribe');
  }

  getBalance(_addresses: string[]): Promise<number> {
    throw new NotImplementedError('getBalance', 'wire blockchain.scripthash.get_balance');
  }

  getAddressHistory(_addresses: string[]): Promise<AddressDelta[]> {
    throw new NotImplementedError('getAddressHistory', 'wire blockchain.scripthash.get_history');
  }

  getUtxos(_addresses: string[]): Promise<NeuraiUtxo[]> {
    throw new NotImplementedError('getUtxos', 'wire blockchain.scripthash.listunspent');
  }

  getMempool(_addresses: string[]): Promise<MempoolEntry[]> {
    throw new NotImplementedError('getMempool', 'wire blockchain.scripthash.get_mempool');
  }

  broadcast(_rawTxHex: string): Promise<string> {
    throw new NotImplementedError('broadcast', 'wire blockchain.transaction.broadcast');
  }

  estimateFee(_targetBlocks: number): Promise<FeeEstimate> {
    throw new NotImplementedError('estimateFee', 'wire blockchain.estimatefee');
  }

  getBlockTimes(_heights: number[]): Promise<Record<number, number>> {
    throw new NotImplementedError('getBlockTimes', 'wire blockchain.block.header');
  }

  async ping(): Promise<boolean> {
    return false;
  }

  /** Diagnostic: surface the configured endpoint for Settings to display. */
  describe(): string {
    return `electrumx://${this.config.url} (${this.chain})`;
  }
}
