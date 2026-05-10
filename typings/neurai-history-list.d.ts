/**
 * Type shim for `@neuraiproject/neurai-history-list`. Same situation as
 * `neurai-rpc`: `dist/types.d.ts` exists but is not surfaced via
 * `package.json#exports`, so TS bundler resolution can't pick it up. Remove
 * once upstream adds a `"types"` condition.
 */
declare module '@neuraiproject/neurai-history-list' {
  export interface IDelta {
    assetName: string;
    satoshis: number;
    txid: string;
    index: number;
    blockindex: number;
    height: number;
    address: string;
  }

  export interface IHistoryAssetEntry {
    assetName: string;
    value: number;
    satoshis: number;
  }

  export interface IHistoryItem {
    isSent: boolean;
    assets: IHistoryAssetEntry[];
    blockHeight: number;
    transactionId: string;
    fee: number;
  }

  export function getHistory(deltas: IDelta[], baseCurrency?: string): IHistoryItem[];

  const _default: { getHistory: typeof getHistory };
  export default _default;
}
