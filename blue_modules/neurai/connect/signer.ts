/**
 * Message signing for Neurai Connect.
 *
 * Every signature the wallet produces for a web site goes through here, both
 * the CAIP-122 login text and any `signMessage` session request. The format is
 * the one the Neurai node validates (`verifymessage`) and the browser extension
 * already produces, so a backend can check it without knowing anything about
 * Neurai Connect:
 *
 * - Legacy addresses (`N…` / `t…`): recoverable compact secp256k1 signature,
 *   base64, produced by `@neuraiproject/neurai-message`.
 * - Post-quantum addresses (`nq1…` / `tnq1…`): ML-DSA-44 payload, also base64.
 *   The wallet stores the 32-byte seed, so the signing key pair is expanded
 *   with `ml_dsa44.keygen(seed)` and checked against the stored public key
 *   before use.
 *
 * Hardware wallets are not supported yet: their key never leaves the device, so
 * signing has to be routed through the device protocol. Until that lands the
 * signer refuses clearly instead of silently signing with something else.
 */

import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { sign as signLegacy, signPQMessage, verifyMessage } from '@neuraiproject/neurai-message';
import { getAddressByWIF } from '@neuraiproject/neurai-key';
import {
  SIGNATURE_TYPE_LEGACY,
  SIGNATURE_TYPE_PQ,
  isPostQuantumAddress,
  signatureTypeForAddress,
} from '@neuraiproject/neurai-connect-core';
import type { AbstractNeuraiWallet } from '../../../class/wallets/abstract-neurai-wallet';
import type { NeuraiChainType } from '../networkConfig';

export class ConnectSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectSignerError';
  }
}

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) throw new ConnectSignerError('invalid key material');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export interface ConnectSignature {
  /** Base64 signature, exactly what `verifyMessage` accepts. */
  signature: string;
  /** CACAO signature type: `neurai-secp256k1-compact` or `neurai-ml-dsa-44`. */
  type: string;
  address: string;
}

/**
 * Signs `message` with the key of `address`, which must belong to `wallet`.
 * The signature is verified locally before it is returned: a wallet must never
 * hand a web site something that will not check out.
 */
export async function signConnectMessage(wallet: AbstractNeuraiWallet, address: string, message: string): Promise<ConnectSignature> {
  if (!address) throw new ConnectSignerError('no address to sign with');
  const material = await wallet.getMessageSigningMaterial(address);
  if (!material) {
    throw new ConnectSignerError(
      'this wallet cannot sign messages for that address (hardware wallets are not supported by Neurai Connect yet)',
    );
  }

  let signature: string;
  if (material.kind === 'legacy') {
    if (isPostQuantumAddress(address)) throw new ConnectSignerError('a post-quantum address cannot be signed with a legacy key');
    // Narrowed to the two legacy networks: only those have WIF keys.
    const network = wallet.network as NeuraiChainType;
    if (network !== 'xna' && network !== 'xna-test') throw new ConnectSignerError(`network ${network} has no WIF keys`);
    const privateKeyHex = getAddressByWIF(network, material.wif).privateKey;
    signature = signLegacy(message, hexToBytes(privateKeyHex), true);
  } else {
    if (!isPostQuantumAddress(address)) throw new ConnectSignerError('a legacy address cannot be signed with a post-quantum key');
    const seed = hexToBytes(material.seedKey);
    if (seed.length !== 32) throw new ConnectSignerError('the post-quantum seed must be 32 bytes');
    const keyPair = ml_dsa44.keygen(seed);
    if (bytesToHex(keyPair.publicKey) !== material.publicKey.trim().toLowerCase()) {
      throw new ConnectSignerError('the post-quantum key expanded from the seed does not match the stored public key');
    }
    signature = signPQMessage(message, keyPair.secretKey, keyPair.publicKey);
  }

  if (!verifyMessage(message, address, signature)) {
    throw new ConnectSignerError('the signature this wallet produced does not verify against the address');
  }
  return { signature, type: signatureTypeForAddress(address), address };
}

export { SIGNATURE_TYPE_LEGACY, SIGNATURE_TYPE_PQ };
