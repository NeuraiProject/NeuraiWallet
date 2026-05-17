/**
 * Backend for neurai-wallet-services.
 *
 * The service speaks a JSON-RPC-like protocol over WebSocket at `/push`:
 * `hello`, `ping`, `address.get_state`, `tx.broadcast`, plus pushed events.
 * This adapter maps that protocol onto the wallet's `NeuraiBackend` surface.
 */

import { AddressDelta, BackendConfig, FeeEstimate, MempoolEntry, NeuraiBackend, NeuraiUtxo } from './NeuraiBackend';
import { CHAIN_PARAMS, type NeuraiChainType } from './networkConfig';

const WIRE_PROTOCOL = 'wss';
const APP_PROTOCOL = 'wss/1';
const CLIENT_NAME = 'NeuraiWallet';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_FEE_RATE_XNA_PER_KB = 0.05;

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
};

type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type WssError = {
  code?: number;
  message?: string;
  [key: string]: unknown;
};

type WssResponse<T> = {
  id?: number | string | null;
  result?: T;
  error?: WssError;
  method?: string;
  params?: unknown;
};

type WssHello = {
  tip_height?: number | null;
  tip_hash?: string | null;
};

type WssBalance = {
  confirmed?: number;
  unconfirmed?: number;
};

type WssHistory = {
  txid: string;
  height: number;
  tx_index?: number;
  asset?: string;
  satoshis?: number;
};

type WssUtxo = {
  txid: string;
  vout: number;
  satoshis: number;
  height?: number;
  asset?: string;
};

type WssMempool = {
  txid: string;
  satoshis?: number;
  prev_txid?: string | null;
  prev_vout?: number | null;
};

type PageInfo = {
  has_more?: boolean;
  next_cursor?: string | null;
};

type WssAddressState = {
  address: string;
  balance?: WssBalance;
  mempool?: WssMempool[];
  history?: WssHistory[];
  utxos?: WssUtxo[];
  asset_utxos?: WssUtxo[];
  page?: PageInfo;
  utxo_page?: PageInfo;
};

function getWebSocketCtor(): WebSocketCtor {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!ctor) throw new Error('WebSocket is not available in this runtime');
  return ctor;
}

function responseError(error: WssError): Error {
  const err = new Error(error.message || 'WSS request failed') as Error & { code?: number; details?: WssError };
  err.code = error.code;
  err.details = error;
  return err;
}

function isOpen(ws: WebSocketLike | null): boolean {
  return !!ws && ws.readyState === 1;
}

export class WssBackend implements NeuraiBackend {
  readonly kind = 'wss' as const;
  readonly chain: NeuraiChainType;

  private readonly url: string;
  private readonly authToken?: string;
  private ws: WebSocketLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private tipHeight = 0;

  constructor(config: Omit<BackendConfig, 'kind'>) {
    this.chain = config.chain;
    this.url = config.url;
    this.authToken = config.authToken || config.password;
  }

  async rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
    switch (method) {
      case 'getblockcount':
        return (await this.getTipHeight()) as T;
      case 'getaddressbalance':
        return (await this.getRpcAddressBalance(params)) as T;
      case 'getaddressdeltas':
        return (await this.getRpcAddressDeltas(params)) as T;
      case 'getaddressutxos':
        return (await this.getRpcAddressUtxos(params)) as T;
      case 'getaddressmempool':
        return (await this.getRpcAddressMempool(params)) as T;
      case 'sendrawtransaction':
        return (await this.broadcast(String(params[0] || ''))) as T;
      case 'estimatesmartfee':
        return { feerate: DEFAULT_FEE_RATE_XNA_PER_KB, blocks: Number(params[0] || 0) } as T;
      default:
        throw new Error(`WSS backend does not support RPC passthrough method: ${method}`);
    }
  }

  async getTipHeight(): Promise<number> {
    await this.ensureConnected();
    return this.tipHeight;
  }

  async getBalance(addresses: string[]): Promise<number> {
    if (addresses.length === 0) return 0;
    const states = await Promise.all(addresses.map(address => this.fetchAddressState(address, false, false)));
    const sats = states.reduce((sum, state) => sum + (state.balance?.confirmed || 0), 0);
    return sats / 1e8;
  }

  async getAddressHistory(addresses: string[]): Promise<AddressDelta[]> {
    if (addresses.length === 0) return [];
    const batches = await Promise.all(addresses.map(address => this.fetchFullHistory(address)));
    return batches.flat();
  }

  async getUtxos(addresses: string[]): Promise<NeuraiUtxo[]> {
    if (addresses.length === 0) return [];
    const batches = await Promise.all(addresses.map(address => this.fetchFullUtxos(address)));
    return batches.flat();
  }

  async getMempool(addresses: string[]): Promise<MempoolEntry[]> {
    if (addresses.length === 0) return [];
    const batches = await Promise.all(
      addresses.map(async address => {
        const state = await this.fetchAddressState(address, false, false);
        return (state.mempool || []).map((m, index) => this.toMempoolEntry(address, m, index));
      }),
    );
    return batches.flat();
  }

  async broadcast(rawTxHex: string): Promise<string> {
    const response = await this.serviceRequest<{ txid: string }>('tx.broadcast', { rawtx: rawTxHex });
    return response.txid;
  }

  async estimateFee(targetBlocks: number): Promise<FeeEstimate> {
    return { targetBlocks, feeRateXnaPerKb: DEFAULT_FEE_RATE_XNA_PER_KB };
  }

  async getBlockTimes(_heights: number[]): Promise<Record<number, number>> {
    return {};
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.serviceRequest<string>('ping', {});
      return pong === 'pong';
    } catch {
      return false;
    }
  }

  private async getRpcAddressBalance(params: unknown[]): Promise<{ balance: number; received: number }> {
    const addresses = this.getAddressesParam(params);
    const states = await Promise.all(addresses.map(address => this.fetchAddressState(address, false, false)));
    const balance = states.reduce((sum, state) => sum + (state.balance?.confirmed || 0), 0);
    return { balance, received: balance };
  }

  private async getRpcAddressDeltas(params: unknown[]): Promise<AddressDelta[]> {
    return this.getAddressHistory(this.getAddressesParam(params));
  }

  private async getRpcAddressUtxos(params: unknown[]): Promise<NeuraiUtxo[]> {
    const query = (params[0] || {}) as { addresses?: unknown; assetName?: unknown };
    const addresses = this.getAddressesParam(params);
    const assetName = typeof query.assetName === 'string' ? query.assetName : undefined;
    const batches = await Promise.all(addresses.map(address => this.fetchFullUtxos(address, assetName)));
    return batches.flat();
  }

  private async getRpcAddressMempool(params: unknown[]): Promise<MempoolEntry[]> {
    return this.getMempool(this.getAddressesParam(params));
  }

  private getAddressesParam(params: unknown[]): string[] {
    const query = (params[0] || {}) as { addresses?: unknown };
    return Array.isArray(query.addresses) ? query.addresses.filter((a): a is string => typeof a === 'string' && a.length > 0) : [];
  }

  private async fetchFullHistory(address: string): Promise<AddressDelta[]> {
    const out: AddressDelta[] = [];
    let cursor: string | null = null;
    do {
      const state = await this.fetchAddressState(address, true, false, { cursor });
      out.push(...(state.history || []).map(item => this.toAddressDelta(address, item)));
      cursor = state.page?.has_more ? state.page.next_cursor || null : null;
    } while (cursor);
    return out;
  }

  private async fetchFullUtxos(address: string, assetName?: string): Promise<NeuraiUtxo[]> {
    const wantsAssets = assetName === '*';
    const state = await this.fetchAddressState(address, false, true, {
      assets: wantsAssets ? true : undefined,
      utxo_limit: 0,
    });
    const native = (state.utxos || []).map(item => this.toUtxo(address, item, 'XNA'));
    if (!assetName) return native;
    const assets = (state.asset_utxos || []).map(item => this.toUtxo(address, item, item.asset || ''));
    if (assetName === '*') return [...native, ...assets];
    return assets.filter(u => u.assetName === assetName);
  }

  private fetchAddressState(
    address: string,
    includeHistory: boolean,
    includeUtxos: boolean,
    extra?: Record<string, unknown>,
  ): Promise<WssAddressState> {
    return this.serviceRequest<WssAddressState>('address.get_state', {
      address,
      include_history: includeHistory,
      include_utxos: includeUtxos,
      ...extra,
    });
  }

  private toAddressDelta(address: string, item: WssHistory): AddressDelta {
    const index = typeof item.tx_index === 'number' ? item.tx_index : 0;
    return {
      address,
      assetName: item.asset || 'XNA',
      blockindex: index,
      height: item.height,
      index,
      satoshis: item.satoshis || 0,
      txid: item.txid,
    };
  }

  private toUtxo(address: string, item: WssUtxo, assetName: string): NeuraiUtxo {
    return {
      address,
      assetName: assetName || 'XNA',
      height: item.height,
      outputIndex: item.vout,
      script: '',
      satoshis: item.satoshis,
      txid: item.txid,
      value: item.satoshis / 1e8,
    };
  }

  private toMempoolEntry(address: string, item: WssMempool, index: number): MempoolEntry {
    return {
      address,
      assetName: 'XNA',
      txid: item.txid,
      index,
      satoshis: item.satoshis || 0,
      timestamp: Math.floor(Date.now() / 1000),
      prevtxid: item.prev_txid || '',
      prevout: item.prev_vout ?? 0,
    };
  }

  private async ensureConnected(): Promise<void> {
    if (isOpen(this.ws)) return;
    if (this.connectPromise) return this.connectPromise;

    const protocols = this.authToken ? [WIRE_PROTOCOL, `auth.${this.authToken}`] : [WIRE_PROTOCOL];
    const ws = new (getWebSocketCtor())(this.url, protocols);
    this.ws = ws;

    this.connectPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`WSS connection timeout: ${this.url}`));
        this.close();
      }, REQUEST_TIMEOUT_MS);

      ws.onmessage = event => this.handleMessage(event.data);
      ws.onerror = event => {
        reject(new Error(`WSS connection failed: ${String(event)}`));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        this.rejectPending(new Error('WSS connection closed'));
        this.ws = null;
        this.connectPromise = null;
      };
      ws.onopen = () => {
        this.sendRequest<WssHello>('hello', {
          client: CLIENT_NAME,
          network: CHAIN_PARAMS[this.chain].network,
          protocol: APP_PROTOCOL,
        })
          .then(hello => {
            clearTimeout(timer);
            if (typeof hello.tip_height === 'number') this.tipHeight = hello.tip_height;
            resolve();
          })
          .catch(err => {
            clearTimeout(timer);
            reject(err);
            this.close();
          });
      };
    });

    return this.connectPromise;
  }

  private async serviceRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();
    return this.sendRequest<T>(method, params);
  }

  private sendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const ws = this.ws;
    if (!isOpen(ws)) return Promise.reject(new Error('WSS connection is not open'));
    const openWs = ws as WebSocketLike;

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WSS request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      openWs.send(payload);
    });
  }

  private handleMessage(data: unknown): void {
    const text = typeof data === 'string' ? data : String(data ?? '');
    let msg: WssResponse<unknown>;
    try {
      msg = JSON.parse(text) as WssResponse<unknown>;
    } catch {
      return;
    }

    if (msg.method) {
      this.handleEvent(msg.method, msg.params);
      return;
    }

    if (msg.id == null) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) pending.reject(responseError(msg.error));
    else pending.resolve(msg.result);
  }

  private handleEvent(method: string, params: unknown): void {
    if (method !== 'chain.tip') return;
    const tip = params as { height?: unknown };
    if (typeof tip.height === 'number') this.tipHeight = tip.height;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private close(): void {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
    this.connectPromise = null;
  }
}
