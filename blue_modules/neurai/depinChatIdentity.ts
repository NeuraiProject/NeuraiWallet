/**
 * Derivation of the dedicated "DePIN chat" identity for a Neurai wallet.
 *
 * The DePIN chat uses a dedicated BIP44 address at account 100
 * (`m/44'/{coinType}'/100'/0/0`) — separate from the wallet's spending
 * addresses. Holding the gating DePIN token at THIS address is what unlocks the
 * chat, and its private key signs/decrypts messages. This mirrors the Neurai
 * web wallet's `deriveDepinChatIdentity` so addresses match across both apps.
 *
 * IMPORTANT — Legacy only. DePIN chat is supported exclusively on Legacy
 * networks (`xna` / `xna-test`). Post-quantum networks (`xna-pq` /
 * `xna-pq-test`) use NIP-022 PQ-HD derivation with no BIP44 path, so there is
 * no chat identity there and the DePIN tab is hidden.
 */

import { getAddressByPath, getCoinType, getHDKey } from '@neuraiproject/neurai-key';

import type { NeuraiChainType } from './networkConfig';

/** Neurai networks that support the BIP44-derived DePIN chat identity. */
export type DepinChatNetwork = Extract<NeuraiChainType, 'xna' | 'xna-test'>;

export interface DepinChatIdentity {
  /** DePIN chat address (Base58 `N…` mainnet / `t…` testnet). */
  address: string;
  /** Private key in WIF format (used to sign/decrypt DePIN messages). */
  wif: string;
  /** Compressed public key, 66 hex chars (33 bytes, `02`/`03` prefix). */
  publicKey: string;
  /** Full derivation path, e.g. `m/44'/1900'/100'/0/0`. */
  path: string;
  coinType: number;
  account: number;
  index: number;
}

/**
 * Type guard: is this chain a Legacy network that supports DePIN chat?
 * Returns false for PQ chains (`xna-pq` / `xna-pq-test`).
 */
export function isDepinChatSupportedNetwork(network: string): network is DepinChatNetwork {
  return network === 'xna' || network === 'xna-test';
}

/** Normalize any pubkey hex to compressed form (33 bytes / 66 hex chars). */
function compressPubKeyHex(pubKeyHex: string): string {
  const hex = (pubKeyHex ?? '').trim().toLowerCase().replace(/^0x/, '');
  if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) {
    return hex;
  }

  // Uncompressed: 65 bytes => 130 hex chars, starts with 04.
  if (hex.length === 130 && hex.startsWith('04')) {
    const xHex = hex.slice(2, 66);
    const yHex = hex.slice(66, 130);
    const yLastByte = parseInt(yHex.slice(-2), 16);
    const prefix = yLastByte % 2 === 0 ? '02' : '03';
    return `${prefix}${xHex}`;
  }

  // Other formats: return as-is and let the caller validate.
  return hex;
}

/**
 * Derive the DePIN chat identity for a Legacy Neurai network. Throws if the
 * derivation fails or the network is unsupported.
 */
export function deriveDepinChatIdentity(params: {
  network: DepinChatNetwork;
  mnemonic: string;
  passphrase?: string;
  account?: number;
  index?: number;
}): DepinChatIdentity {
  const account = params.account ?? 100;
  const index = params.index ?? 0;

  const mnemonic = (params.mnemonic ?? '').trim();
  if (!mnemonic) {
    throw new Error('Missing mnemonic');
  }

  const passphrase = params.passphrase ?? '';

  const hdKey = getHDKey(params.network, mnemonic, passphrase);
  const coinType = getCoinType(params.network);

  const path = `m/44'/${coinType}'/${account}'/0/${index}`;
  const addrObj = getAddressByPath(params.network, hdKey, path);

  const wif = String(addrObj?.WIF ?? '').trim();
  const address = String(addrObj?.address ?? '').trim();
  const publicKey = compressPubKeyHex(String(addrObj?.publicKey ?? ''));

  if (!address) throw new Error('Failed to derive DePIN chat address');
  if (!wif) throw new Error('Failed to derive DePIN chat private key (WIF)');
  if (publicKey.length !== 66) throw new Error('Failed to derive compressed public key for DePIN chat identity');

  return { address, wif, publicKey, path, coinType, account, index };
}
