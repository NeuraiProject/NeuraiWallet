/**
 * RPC backend for Neurai. Talks to a Neurai full node via JSON-RPC.
 *
 * Wraps `@neuraiproject/neurai-rpc::getRPC`, which is the same primitive that
 * `neurai-jswallet` uses internally. We deliberately keep this layer thin and
 * stateless so multiple wallets on different chains can share a backend
 * without coupling.
 */

import { getRPC, methods } from '@neuraiproject/neurai-rpc';

import { AddressDelta, BackendConfig, FeeEstimate, MempoolEntry, NeuraiBackend, NeuraiUtxo } from './NeuraiBackend';
import type { NeuraiChainType } from './networkConfig';

/** One full XNA, in satoshis. Same constant the lib uses internally. */
const ONE_FULL_COIN = 1e8;

type RpcCaller = <T = unknown>(method: string, params: unknown[]) => Promise<T>;

interface AddressBalanceResponse {
  balance: number;
  received: number;
}

interface EstimateSmartFeeResponse {
  feerate?: number;
  blocks?: number;
  errors?: string[];
}

export class RpcBackend implements NeuraiBackend {
  readonly kind = 'rpc' as const;
  readonly chain: NeuraiChainType;
  private readonly rpcCaller: RpcCaller;

  constructor(config: Omit<BackendConfig, 'kind'>) {
    this.chain = config.chain;
    const username = config.username || 'anonymous';
    const password = config.password || 'anonymous';
    this.rpcCaller = getRPC(username, password, config.url) as unknown as RpcCaller;
  }

  rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
    return this.rpcCaller<T>(method, params);
  }

  async getTipHeight(): Promise<number> {
    return this.rpcCaller<number>(methods.getblockcount, []);
  }

  async getBalance(addresses: string[]): Promise<number> {
    if (addresses.length === 0) return 0;
    const response = await this.rpcCaller<AddressBalanceResponse>(methods.getaddressbalance, [{ addresses }, false]);
    return response.balance / ONE_FULL_COIN;
  }

  async getAddressHistory(addresses: string[]): Promise<AddressDelta[]> {
    if (addresses.length === 0) return [];
    return this.rpcCaller<AddressDelta[]>(methods.getaddressdeltas, [{ addresses }]);
  }

  async getUtxos(addresses: string[]): Promise<NeuraiUtxo[]> {
    if (addresses.length === 0) return [];
    return this.rpcCaller<NeuraiUtxo[]>(methods.getaddressutxos, [{ addresses }]);
  }

  async getMempool(addresses: string[]): Promise<MempoolEntry[]> {
    if (addresses.length === 0) return [];
    return this.rpcCaller<MempoolEntry[]>(methods.getaddressmempool, [{ addresses }]);
  }

  async broadcast(rawTxHex: string): Promise<string> {
    return this.rpcCaller<string>(methods.sendrawtransaction, [rawTxHex]);
  }

  async estimateFee(targetBlocks: number): Promise<FeeEstimate> {
    const response = await this.rpcCaller<EstimateSmartFeeResponse>(methods.estimatesmartfee, [targetBlocks]);
    return {
      targetBlocks,
      feeRateXnaPerKb: response.feerate ?? 0,
    };
  }

  async getBlockTimes(heights: number[]): Promise<Record<number, number>> {
    const unique = Array.from(new Set(heights.filter(h => h > 0)));
    if (unique.length === 0) return {};
    const out: Record<number, number> = {};
    await Promise.all(
      unique.map(async height => {
        try {
          const hash = await this.rpcCaller<string>(methods.getblockhash, [height]);
          const header = await this.rpcCaller<{ time: number }>(methods.getblockheader, [hash]);
          if (typeof header?.time === 'number') out[height] = header.time;
        } catch (err) {
          console.debug('getBlockTimes: failed for height', height, err);
        }
      }),
    );
    return out;
  }

  async ping(): Promise<boolean> {
    try {
      await this.getTipHeight();
      return true;
    } catch {
      return false;
    }
  }
}
