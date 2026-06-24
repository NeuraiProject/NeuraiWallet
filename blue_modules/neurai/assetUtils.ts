/**
 * Helpers for Neurai Assets (tokens).
 *
 * Neurai (a Ravencoin fork) supports native assets at the protocol level. An
 * asset's "type" is derived purely from the shape of its name — the same
 * classification the Neurai web wallet uses (`asset-utils.ts`):
 *
 *   FOO        root asset
 *   FOO/BAR    sub-asset            (contains '/')
 *   FOO#TAG    unique asset / NFT   (contains '#')
 *   FOO!       owner token          (ends with '!')
 *   $FOO       restricted asset     (starts with '$')
 *   #FOO       qualifier            (starts with '#')
 *   &FOO       DePIN asset          (starts with '&')
 *
 * This module is intentionally dependency-free (no engine, no network) so it
 * can be used from both the wallet layer and pure UI components.
 */

export type NeuraiAssetType = 'root' | 'sub' | 'unique' | 'owner' | 'restricted' | 'qualifier' | 'depin';

/** A token held by a wallet, ready for display. */
export interface NeuraiHeldAsset {
  /** Full asset name, e.g. `FOO`, `FOO/BAR`, `FOO#TAG`. */
  name: string;
  /** Classification derived from the name. */
  type: NeuraiAssetType;
  /** Spendable amount in full asset units (not satoshis). */
  amount: number;
}

/**
 * Classify an asset by its name. Prefix markers (`$`, `#`, `&`, trailing `!`)
 * are checked before the generic "contains" markers (`#`, `/`) so e.g. `#FOO`
 * is a qualifier rather than a unique asset.
 */
export function getAssetType(name: string): NeuraiAssetType {
  if (name.endsWith('!')) return 'owner';
  if (name.startsWith('$')) return 'restricted';
  if (name.startsWith('#')) return 'qualifier';
  if (name.startsWith('&')) return 'depin';
  if (name.includes('#')) return 'unique';
  if (name.includes('/')) return 'sub';
  return 'root';
}

/**
 * Format an asset amount for display: up to 8 decimals with trailing zeros
 * trimmed (e.g. `5`, `5.25`, `0.001`). Asset amounts are always carried
 * internally as integers scaled by 1e8, so dividing by 1e8 and trimming yields
 * the correct human value regardless of the asset's declared divisibility.
 */
export function formatAssetAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  return Number(amount.toFixed(8)).toString();
}
