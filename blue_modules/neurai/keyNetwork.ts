/**
 * Translation from the app's chain identifiers to neurai-key 5 networks.
 *
 * The app (and jswallet) keep the network names they had with neurai-key 4,
 * but neurai-key 5 reuses those names for other address types: there `xna` /
 * `xna-test` are ECDSA witness v3 (`nq1r…` / `tnq1r…`, `m/84'`) and `xna-pq`
 * is the strict PQ witness v2 (`pq1z…`). Handing a wallet chain straight to a
 * `@neuraiproject/neurai-key` function derives a different address without any
 * error, so every direct call goes through this table.
 */

import type { NeuraiChainType } from './networkConfig';

/** neurai-key 5 labels of the Legacy P2PKH networks (`m/44'`, 4.x derivation). */
export type LegacyKeyNetwork = 'xna-legacy' | 'xna-legacy-test';

/** neurai-key 5 labels of the generic AuthScript witness v1 networks (`nc1p…` / `tnc1p…`). */
export type AuthScriptKeyNetwork = 'xna-authscript' | 'xna-authscript-test';

/** neurai-key 5 labels of the strict ECDSA witness v3 networks (`nq1r…` / `tnq1r…`, `m/84'`). */
export type ECDSAKeyNetwork = 'xna' | 'xna-test';

const LEGACY_KEY_NETWORK: Record<NeuraiChainType, LegacyKeyNetwork | null> = {
  xna: 'xna-legacy',
  'xna-test': 'xna-legacy-test',
  'xna-ecdsa': null,
  'xna-ecdsa-test': null,
  'xna-pq': null,
  'xna-pq-test': null,
};

const ECDSA_KEY_NETWORK: Record<NeuraiChainType, ECDSAKeyNetwork | null> = {
  xna: null,
  'xna-test': null,
  'xna-ecdsa': 'xna',
  'xna-ecdsa-test': 'xna-test',
  'xna-pq': null,
  'xna-pq-test': null,
};

const AUTHSCRIPT_KEY_NETWORK: Record<NeuraiChainType, AuthScriptKeyNetwork> = {
  xna: 'xna-authscript',
  'xna-test': 'xna-authscript-test',
  'xna-ecdsa': 'xna-authscript',
  'xna-ecdsa-test': 'xna-authscript-test',
  'xna-pq': 'xna-authscript',
  'xna-pq-test': 'xna-authscript-test',
};

/**
 * neurai-key 5 network that derives the same Legacy P2PKH addresses as the
 * app's chain did with neurai-key 4. Null for the ECDSA and PQ chains, whose
 * addresses come from other trees.
 */
export function legacyKeyNetworkFor(chain: string): LegacyKeyNetwork | null {
  return Object.prototype.hasOwnProperty.call(LEGACY_KEY_NETWORK, chain) ? LEGACY_KEY_NETWORK[chain as NeuraiChainType] : null;
}

/** Same as {@link legacyKeyNetworkFor}, but throws for chains without a Legacy tree. */
export function requireLegacyKeyNetwork(chain: string): LegacyKeyNetwork {
  const network = legacyKeyNetworkFor(chain);
  if (!network) throw new Error(`No Legacy key network for chain ${chain}`);
  return network;
}

/**
 * neurai-key 5 network of an ECDSA witness v3 chain (`m/84'`, compressed
 * secp256k1 keys and WIF). Null for the other chains.
 */
export function ecdsaKeyNetworkFor(chain: string): ECDSAKeyNetwork | null {
  return Object.prototype.hasOwnProperty.call(ECDSA_KEY_NETWORK, chain) ? ECDSA_KEY_NETWORK[chain as NeuraiChainType] : null;
}

/** neurai-key 5 network of the generic AuthScript witness v1 address used by the app's PQ wallets. */
export function authScriptKeyNetworkFor(chain: NeuraiChainType): AuthScriptKeyNetwork {
  return AUTHSCRIPT_KEY_NETWORK[chain];
}

/**
 * jswallet network of a mnemonic wallet on this chain. Testnet PQ wallets use
 * the node's PQ address type (strict witness v2, `tpq1z…`); mainnet keeps the
 * 4.x AuthScript v1 derivation (`nc1p…`, same commitment as the old `nq1p…`).
 * The ECDSA chains share their names with jswallet.
 */
export type EngineNetwork = 'xna' | 'xna-test' | 'xna-ecdsa' | 'xna-ecdsa-test' | 'xna-pq' | 'xna-pq-strict-test';

export function engineNetworkFor(chain: NeuraiChainType): EngineNetwork {
  return chain === 'xna-pq-test' ? 'xna-pq-strict-test' : chain;
}

/**
 * neurai-sign-transaction 3 label for a jswallet network (the same table
 * jswallet uses internally). The signer only takes the chain and WIF version
 * from it; the input type comes from each prevout script.
 */
const SIGNER_NETWORK: Record<
  EngineNetwork | 'xna-pq-test',
  'xna-legacy' | 'xna-legacy-test' | 'xna' | 'xna-test' | 'xna-authscript' | 'xna-authscript-test' | 'xna-pq-test'
> = {
  xna: 'xna-legacy',
  'xna-test': 'xna-legacy-test',
  'xna-ecdsa': 'xna',
  'xna-ecdsa-test': 'xna-test',
  'xna-pq': 'xna-authscript',
  'xna-pq-test': 'xna-authscript-test',
  'xna-pq-strict-test': 'xna-pq-test',
};

export function signerNetworkFor(network: EngineNetwork | 'xna-pq-test'): (typeof SIGNER_NETWORK)[keyof typeof SIGNER_NETWORK] {
  return SIGNER_NETWORK[network];
}
