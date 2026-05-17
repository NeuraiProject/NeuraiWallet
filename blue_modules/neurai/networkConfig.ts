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
  /** Default public JSON-RPC endpoint. Kept as a fallback for self-hosted/debug flows. */
  defaultRpcUrl: string;
  /** Default wallet service endpoint (JSON-RPC-like protocol over WSS). */
  defaultWssUrl: string;
  /** Optional wallet service auth token sent as `auth.<token>` WebSocket subprotocol. */
  defaultWssAuthToken?: string;
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
const URL_NEURAI_MAINNET_WSS = 'wss://wallet-main-wss.neurai.org:443/push';
const URL_NEURAI_TESTNET_WSS = 'wss://wallet-testnet-wss.neurai.org:443/push';
const AUTH_NEURAI_TESTNET_WSS = 'testnet-wss-token-do-not-use-in-production';

export const CHAIN_PARAMS: Record<NeuraiChainType, ChainParams> = {
  xna: {
    chain: 'xna',
    network: 'mainnet',
    kind: 'legacy',
    defaultRpcUrl: URL_NEURAI_MAINNET,
    defaultWssUrl: URL_NEURAI_MAINNET_WSS,
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
    defaultWssUrl: URL_NEURAI_TESTNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_TESTNET_WSS,
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
    defaultWssUrl: URL_NEURAI_MAINNET_WSS,
    bip44CoinType: 1900,
    hrp: 'nq',
  },
  'xna-pq-test': {
    chain: 'xna-pq-test',
    network: 'testnet',
    kind: 'pq',
    defaultRpcUrl: URL_NEURAI_TESTNET,
    defaultWssUrl: URL_NEURAI_TESTNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_TESTNET_WSS,
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
