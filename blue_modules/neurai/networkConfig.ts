/**
 * Neurai network configuration.
 *
 * The app supports four chain identifiers, two for legacy ECDSA wallets and
 * two for post-quantum (ML-DSA-44) wallets. Mainnet and testnet are wired in
 * parallel so flipping a single setting (`activeNetwork`) switches the whole
 * stack — RPC URL, address prefixes, BIP44 coin type, hrp.
 *
 * Default during development is testnet, since the user-visible plan is
 * "testnet first, mainnet ready for the fork".
 */

export type NeuraiChainType = 'xna' | 'xna-test' | 'xna-pq' | 'xna-pq-test';

export type NeuraiNetwork = 'mainnet' | 'testnet';

export type WalletKind = 'legacy' | 'pq';

export interface ChainParams {
  chain: NeuraiChainType;
  network: NeuraiNetwork;
  kind: WalletKind;
  /** Default public RPC endpoint. Overridable from settings. */
  defaultRpcUrl: string;
  /** BIP44 coin type used for derivation. */
  bip44CoinType: number;
  /** Base58 version byte for legacy P2PKH addresses (undefined for PQ). */
  pubkeyAddress?: number;
  /** Base58 version byte for legacy P2SH addresses (undefined for PQ). */
  scriptAddress?: number;
  /** Base58 version byte for WIF private keys (undefined for PQ). */
  secretKey?: number;
  /** Bech32m human-readable prefix for PQ AuthScript addresses. */
  hrp?: string;
}

const URL_NEURAI_MAINNET = 'https://rpc-main.neurai.org/rpc';
const URL_NEURAI_TESTNET = 'https://rpc-testnet.neurai.org/rpc';

export const CHAIN_PARAMS: Record<NeuraiChainType, ChainParams> = {
  xna: {
    chain: 'xna',
    network: 'mainnet',
    kind: 'legacy',
    defaultRpcUrl: URL_NEURAI_MAINNET,
    bip44CoinType: 1900,
    pubkeyAddress: 53,
    scriptAddress: 117,
    secretKey: 128,
  },
  'xna-test': {
    chain: 'xna-test',
    network: 'testnet',
    kind: 'legacy',
    defaultRpcUrl: URL_NEURAI_TESTNET,
    bip44CoinType: 1,
    pubkeyAddress: 127,
    scriptAddress: 196,
    secretKey: 239,
  },
  'xna-pq': {
    chain: 'xna-pq',
    network: 'mainnet',
    kind: 'pq',
    defaultRpcUrl: URL_NEURAI_MAINNET,
    bip44CoinType: 1900,
    hrp: 'nq',
  },
  'xna-pq-test': {
    chain: 'xna-pq-test',
    network: 'testnet',
    kind: 'pq',
    defaultRpcUrl: URL_NEURAI_TESTNET,
    bip44CoinType: 1,
    hrp: 'tnq',
  },
};

export const DEFAULT_NETWORK: NeuraiNetwork = 'testnet';

export function chainFor(network: NeuraiNetwork, kind: WalletKind): NeuraiChainType {
  if (kind === 'pq') return network === 'mainnet' ? 'xna-pq' : 'xna-pq-test';
  return network === 'mainnet' ? 'xna' : 'xna-test';
}

export function isPQChain(chain: NeuraiChainType): boolean {
  return chain === 'xna-pq' || chain === 'xna-pq-test';
}

export function isTestnetChain(chain: NeuraiChainType): boolean {
  return chain === 'xna-test' || chain === 'xna-pq-test';
}
