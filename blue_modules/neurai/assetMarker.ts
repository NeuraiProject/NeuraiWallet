/**
 * NIP-040 asset marker.
 *
 * Every asset payload opens with a 3-byte marker. NIP-040 migrates it from the
 * Ravencoin-inherited `rvn` to `xna` at a per-chain activation height, and a
 * chain past that height rejects the legacy marker with
 * `bad-txns-legacy-asset-marker-after-nip040`.
 *
 * `@neuraiproject/neurai-create-transaction` takes the marker as an OPTIONAL
 * parameter and keeps `rvn` when it is omitted, so every local asset build in
 * this app has to pass it explicitly. The library never infers it.
 *
 * ## Why a table and not a node lookup
 *
 * The parameter exists so the caller can decide, and what there is to decide
 * changes mainly during a chain's *transition window* — the stretch around the
 * activation height where the right marker depends on the block. Neither chain
 * this app supports is in that situation today:
 *
 *   - mainnet uses `rvn` and will keep doing so until the protocol announces a
 *     migration (the node has `nAssetMarkerNip040Height = INT_MAX`, with
 *     `H_main` to be set in a later release);
 *   - testnet activated at block 303000 and is well past it, so `xna`.
 *
 * Asking `getblockchaininfo` for a value that is currently fixed and known
 * would add a call, a failure mode and a backend dependency for nothing. This
 * is this app's policy, not a claim about the library or the protocol: the
 * lookup stays a valid option if the situation changes (see the caveat below).
 *
 * ## The caveat
 *
 * A table asserts something about the chain without looking at it. Against a
 * testnet node that has NOT synced past block 303000 this returns `xna` and
 * that node will reject it. Public proxies are far past it, but a freshly
 * started private node is not.
 *
 * ## The day mainnet migrates
 *
 * This file is the only thing to change.
 */

import type { NeuraiChainType } from './networkConfig';

/** The marker as the node reports it in `getblockchaininfo.asset_marker`. */
export type AssetMarker = 'rvn' | 'xna';

/**
 * The marker each supported chain requires.
 *
 * Exhaustive over `NeuraiChainType` on purpose: adding a chain without deciding
 * its marker becomes a compile error rather than a silent default.
 */
const MARKER_BY_CHAIN: Record<NeuraiChainType, AssetMarker> = {
  xna: 'rvn',
  'xna-pq': 'rvn',
  'xna-test': 'xna',
  'xna-pq-test': 'xna',
};

/**
 * The NIP-040 marker to stamp on asset outputs for `chain`.
 *
 * Throws on an unknown value instead of falling back: guessing `xna` would
 * build transactions mainnet rejects, and guessing `rvn` would build
 * transactions testnet rejects. Neither default is safe, so there is none.
 *
 * @param chain - Chain identifier of the wallet building the transaction
 * @returns `'rvn'` or `'xna'`
 * @throws If `chain` is not a supported chain identifier
 */
export function markerForChain(chain: NeuraiChainType): AssetMarker {
  const marker = MARKER_BY_CHAIN[chain];
  if (!marker) {
    throw new Error(
      `Unknown chain "${chain}": cannot decide the NIP-040 asset marker. ` +
        'Add it to MARKER_BY_CHAIN in blue_modules/neurai/assetMarker.ts.',
    );
  }
  return marker;
}
