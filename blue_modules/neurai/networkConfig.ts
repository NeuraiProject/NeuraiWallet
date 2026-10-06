/**
 * Neurai network configuration.
 *
 * The app supports six chain identifiers, one per network for each wallet
 * kind: Legacy P2PKH, ECDSA witness v3 and post-quantum (ML-DSA-44). Mainnet
 * and testnet are wired in
 * parallel so flipping a single setting (`activeNetwork`) switches the whole
 * stack — RPC URL, address prefixes, BIP44 coin type, hrp. These are the app's
 * own names; the neurai-key 5 / jswallet networks behind them are in
 * `keyNetwork.ts`.
 *
 * Default during development is testnet, since the user-visible plan is
 * "testnet first, mainnet ready for the fork".
 */

import { TESTNET_GENESIS_HASH } from '@neuraiproject/neurai-rpc';

export type NeuraiChainType = 'xna' | 'xna-test' | 'xna-ecdsa' | 'xna-ecdsa-test' | 'xna-pq' | 'xna-pq-test';

export type NeuraiNetwork = 'mainnet' | 'testnet';

export type WalletKind = 'legacy' | 'ecdsa' | 'pq';

export interface ChainParams {
  chain: NeuraiChainType;
  network: NeuraiNetwork;
  kind: WalletKind;
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
  /** Bech32m human-readable prefix of the wallet's witness addresses (ECDSA and PQ). */
  hrp?: string;
  /** Genesis block hash (RPC byte order) the wallet service must report, when pinned. */
  expectedGenesisHash?: string;
}

const URL_NEURAI_MAINNET_WSS = 'wss://wallet-main-wss.neurai.org:443/push';
const URL_NEURAI_TESTNET_WSS = 'wss://wallet-testnet-wss.neurai.org:443/push';
const AUTH_NEURAI_MAINNET_WSS = '823huiod90234SDSDS232ewwd23ewdcn9eiiworhjj9iof';
const AUTH_NEURAI_TESTNET_WSS = 'testnet-wss-token-do-not-use-in-production';

export const CHAIN_PARAMS: Record<NeuraiChainType, ChainParams> = {
  xna: {
    chain: 'xna',
    network: 'mainnet',
    kind: 'legacy',
    defaultWssUrl: URL_NEURAI_MAINNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_MAINNET_WSS,
    bip44CoinType: 1900,
    pubkeyAddress: 53,
    scriptAddress: 117,
    secretKey: 128,
  },
  'xna-test': {
    chain: 'xna-test',
    network: 'testnet',
    kind: 'legacy',
    defaultWssUrl: URL_NEURAI_TESTNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_TESTNET_WSS,
    bip44CoinType: 1,
    pubkeyAddress: 127,
    scriptAddress: 196,
    secretKey: 239,
    expectedGenesisHash: TESTNET_GENESIS_HASH,
  },
  'xna-ecdsa': {
    chain: 'xna-ecdsa',
    network: 'mainnet',
    kind: 'ecdsa',
    defaultWssUrl: URL_NEURAI_MAINNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_MAINNET_WSS,
    // Strict ECDSA witness v3 (`nq1r…`), derived under m/84'.
    bip44CoinType: 1900,
    secretKey: 128,
    hrp: 'nq',
  },
  'xna-ecdsa-test': {
    chain: 'xna-ecdsa-test',
    network: 'testnet',
    kind: 'ecdsa',
    defaultWssUrl: URL_NEURAI_TESTNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_TESTNET_WSS,
    // The node's `getnewaddress "" ecdsa` type (`tnq1r…`).
    bip44CoinType: 1,
    secretKey: 239,
    hrp: 'tnq',
    expectedGenesisHash: TESTNET_GENESIS_HASH,
  },
  'xna-pq': {
    chain: 'xna-pq',
    network: 'mainnet',
    kind: 'pq',
    defaultWssUrl: URL_NEURAI_MAINNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_MAINNET_WSS,
    bip44CoinType: 1900,
    // Generic AuthScript witness v1 (the 4.x derivation, formerly `nq1p…`).
    hrp: 'nc',
  },
  'xna-pq-test': {
    chain: 'xna-pq-test',
    network: 'testnet',
    kind: 'pq',
    defaultWssUrl: URL_NEURAI_TESTNET_WSS,
    defaultWssAuthToken: AUTH_NEURAI_TESTNET_WSS,
    bip44CoinType: 1,
    // Strict PQ witness v2, the node's `getnewaddress "" pq` type.
    hrp: 'tpq',
    expectedGenesisHash: TESTNET_GENESIS_HASH,
  },
};

export const DEFAULT_NETWORK: NeuraiNetwork = 'testnet';

export function chainFor(network: NeuraiNetwork, kind: WalletKind): NeuraiChainType {
  if (kind === 'pq') return network === 'mainnet' ? 'xna-pq' : 'xna-pq-test';
  if (kind === 'ecdsa') return network === 'mainnet' ? 'xna-ecdsa' : 'xna-ecdsa-test';
  return network === 'mainnet' ? 'xna' : 'xna-test';
}

/** Wallet kind of a chain; undefined for an unknown chain. */
export function kindOfChain(chain: string): WalletKind | undefined {
  return Object.prototype.hasOwnProperty.call(CHAIN_PARAMS, chain) ? CHAIN_PARAMS[chain as NeuraiChainType].kind : undefined;
}

export function isPQChain(chain: NeuraiChainType): boolean {
  return chain === 'xna-pq' || chain === 'xna-pq-test';
}

export function isTestnetChain(chain: NeuraiChainType): boolean {
  return Object.prototype.hasOwnProperty.call(CHAIN_PARAMS, chain) && CHAIN_PARAMS[chain].network === 'testnet';
}

/**
 * Wallet kinds available on `network`. The witness families (ECDSA v3 and PQ)
 * are active on testnet only; mainnet offers them once they activate there.
 */
export function isKindAvailable(network: NeuraiNetwork, kind: WalletKind): boolean {
  return kind === 'legacy' || network === 'testnet';
}
