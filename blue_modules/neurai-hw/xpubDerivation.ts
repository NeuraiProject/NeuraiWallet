/**
 * BIP32 public derivation from an account xpub, for legacy (ECDSA P2PKH)
 * hardware wallets. The NeuraiHW device exposes its account extended public key
 * (`m/44'/coin'/0'`) via `get_bip32_pubkey`; the app derives receive (`0/i`) and
 * change (`1/i`) addresses from it without involving the device.
 *
 * Implemented with `@noble` + `@scure/base` (already present) — no new
 * dependency. Only non-hardened CKDpub is needed (`0/i`, `1/i`), so the public
 * key is enough; no private material is involved.
 */

import { Buffer } from 'buffer';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { base58check } from '@scure/base';
import { Point } from '@noble/secp256k1';
import { publicKeyToAddress } from '@neuraiproject/neurai-key';

import type { NeuraiChainType } from '../neurai';

/** neurai-key Network for legacy P2PKH derivation. */
type LegacyNetwork = 'xna' | 'xna-test';

const b58c = base58check(sha256);

interface Bip32Node {
  chainCode: Uint8Array;
  pubkey: Uint8Array; // 33-byte compressed
}

/** Decode a base58check xpub into its chain code + compressed public key. */
function decodeXpub(xpub: string): Bip32Node {
  const data = b58c.decode(xpub); // 78-byte payload (version..pubkey), no checksum
  if (data.length !== 78) {
    throw new Error(`Invalid xpub length: ${data.length}`);
  }
  // layout: version(4) depth(1) parentFp(4) childNumber(4) chainCode(32) key(33)
  return {
    chainCode: data.slice(13, 45),
    pubkey: data.slice(45, 78),
  };
}

/** 4-byte big-endian serialization of a non-hardened child index. */
function ser32(index: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, index, false);
  return b;
}

/** BIP32 non-hardened child public-key derivation (CKDpub). */
function ckdPub(node: Bip32Node, index: number): Bip32Node {
  if (index >= 0x80000000) {
    throw new Error('Hardened derivation requires a private key');
  }
  const data = new Uint8Array(33 + 4);
  data.set(node.pubkey, 0);
  data.set(ser32(index), 33);
  const I = hmac(sha512, node.chainCode, data);
  const IL = I.slice(0, 32);
  const IR = I.slice(32);
  // childKey = point(IL) + parentKey
  const childPoint = Point.fromPrivateKey(IL).add(Point.fromHex(node.pubkey));
  return { chainCode: IR, pubkey: childPoint.toRawBytes(true) };
}

/** Map our internal chain id to the neurai-key legacy network. */
function legacyNetworkFor(chain: NeuraiChainType): LegacyNetwork {
  return chain.includes('test') ? 'xna-test' : 'xna';
}

export interface DerivedLegacyAddress {
  address: string;
  /** Compressed secp256k1 public key (hex). */
  pubkeyHex: string;
  /** Branch (0 = external/receive, 1 = internal/change). */
  change: 0 | 1;
  index: number;
}

/**
 * Derive a legacy P2PKH address (and its pubkey) from the account xpub at
 * `change/index` (relative to the account node `m/44'/coin'/0'`).
 */
export function deriveLegacyAddress(xpub: string, chain: NeuraiChainType, change: 0 | 1, index: number): DerivedLegacyAddress {
  const account = decodeXpub(xpub);
  const branch = ckdPub(account, change);
  const leaf = ckdPub(branch, index);
  const pubkeyHex = Buffer.from(leaf.pubkey).toString('hex');
  const address = publicKeyToAddress(legacyNetworkFor(chain), leaf.pubkey);
  return { address, pubkeyHex, change, index };
}
