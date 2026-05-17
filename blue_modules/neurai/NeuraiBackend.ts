/**
 * Backend abstraction for Neurai network access.
 *
 * Two implementations live alongside each other:
 *   - WssBackend (default) talks to neurai-wallet-services over WebSocket.
 *   - RpcBackend (fallback) talks to a Neurai full node via JSON-RPC,
 *     wrapped by `@neuraiproject/neurai-jswallet` and `@neuraiproject/neurai-rpc`.
 *   - ElectrumXBackend (skeleton) is reserved for the future, when an ElectrumX
 *     server for Neurai is available. All methods throw `NotImplementedError`
 *     today; the surface is here so the rest of the app can already program
 *     against a single interface.
 *
 * The active backend is selected from settings (`backendKind`). Default is
 * `'wss'`.
 */

import type { NeuraiChainType } from './networkConfig';

export type BackendKind = 'wss' | 'rpc' | 'electrumx';

export interface BackendConfig {
  kind: BackendKind;
  chain: NeuraiChainType;
  /** WSS endpoint (wss://.../push), RPC endpoint (https://...) or Electrum host (host:port). */
  url: string;
  /** Optional credentials for self-hosted RPC. Public endpoints accept anonymous. */
  username?: string;
  password?: string;
  /** Optional neurai-wallet-services auth token. Sent as `auth.<token>` subprotocol. */
  authToken?: string;
}

/** Address-level activity item. Mirrors `IAddressDelta` from neurai-jswallet. */
export interface AddressDelta {
  address: string;
  assetName: string;
  blockindex: number;
  height: number;
  index: number;
  satoshis: number;
  txid: string;
  prevtxid?: string;
}

/** UTXO in canonical Neurai shape. Mirrors `IUTXO`. */
export interface NeuraiUtxo {
  address: string;
  assetName: string;
  height?: number;
  outputIndex: number;
  script: string;
  satoshis: number;
  txid: string;
  value: number;
}

export interface MempoolEntry {
  address: string;
  assetName: string;
  txid: string;
  index: number;
  satoshis: number;
  timestamp: number;
  prevtxid: string;
  prevout: number;
}

/** Fee estimate in XNA per kilobyte for a target confirmation depth (blocks). */
export interface FeeEstimate {
  /** Target confirmation depth in blocks. */
  targetBlocks: number;
  /** Fee rate in XNA / kB as returned by `estimatesmartfee`. */
  feeRateXnaPerKb: number;
}

export class NotImplementedError extends Error {
  constructor(method: string, hint = '') {
    super(`NeuraiBackend.${method} is not implemented yet${hint ? ` — ${hint}` : ''}`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Thin transport layer. Wallet-level concerns (key derivation, signing, address
 * scanning) stay in `class/wallets/neurai-*-wallet.ts`. The backend only owns
 * the network round-trip.
 */
export interface NeuraiBackend {
  readonly kind: BackendKind;
  readonly chain: NeuraiChainType;

  /** Generic JSON-RPC passthrough. Useful for advanced/diagnostic calls. */
  rpc<T = unknown>(method: string, params: unknown[]): Promise<T>;

  /** Latest block height. */
  getTipHeight(): Promise<number>;

  /** Aggregate XNA balance across the given addresses. */
  getBalance(addresses: string[]): Promise<number>;

  /** Address deltas — basis for the transaction history list. */
  getAddressHistory(addresses: string[]): Promise<AddressDelta[]>;

  /** Spendable UTXOs. */
  getUtxos(addresses: string[]): Promise<NeuraiUtxo[]>;

  /** Mempool entries that touch the given addresses. */
  getMempool(addresses: string[]): Promise<MempoolEntry[]>;

  /** Submit a signed transaction (hex). Returns the txid. */
  broadcast(rawTxHex: string): Promise<string>;

  /** Smart fee estimate for `targetBlocks` confirmation depth. */
  estimateFee(targetBlocks: number): Promise<FeeEstimate>;

  /**
   * Unix timestamps (seconds since epoch) for the given block heights.
   * Returns a mapping `{ height -> blocktime }`. Heights that fail to
   * resolve are simply omitted; callers should guard with `?? Date.now()/1e3`.
   */
  getBlockTimes(heights: number[]): Promise<Record<number, number>>;

  /** Verify the backend is reachable. Used by the Settings screen. */
  ping(): Promise<boolean>;
}
