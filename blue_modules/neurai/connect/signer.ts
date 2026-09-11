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
 * Hardware wallets never expose their key, so their signature is produced by
 * the device (`sign_message` over USB) and only checked here. The firmware
 * signs with its one fixed key and reports the address it signed for; that
 * address has to be the session address, otherwise the device plugged in is
 * not the one this wallet was added from and the signature would never verify.
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
import type { NeuraiESP32 } from '@neuraiproject/neurai-sign-esp32/react-native';
import type { AbstractNeuraiWallet } from '../../../class/wallets/abstract-neurai-wallet';
import type { NeuraiChainType } from '../networkConfig';
import { withDevice } from '../../neurai-hw/deviceQueue';

/**
 * `NeuraiHardwareWallet.type`, as a literal: importing the class here would
 * drag the USB transport into every consumer of the signer (and into the unit
 * tests), and the string is the only thing the signer needs from it.
 */
const HARDWARE_WALLET_TYPE = 'NeuraiHardware';

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

export interface ConnectSignOptions {
  /**
   * Hardware wallets only: opens (or reuses) the USB link to the NeuraiHW
   * device. The screen owns the link, so it passes the hook's `connect`; the
   * signer just asks for a device when it needs one.
   */
  connectDevice?: () => Promise<NeuraiESP32 | null>;
}

/**
 * Hardware route: the device signs, the app checks. `ping` needs no on-device
 * approval, so the user confirms exactly once, on the sign prompt.
 */
async function signWithDevice(
  connectDevice: (() => Promise<NeuraiESP32 | null>) | undefined,
  address: string,
  message: string,
): Promise<string> {
  if (!connectDevice) throw new ConnectSignerError('a hardware wallet signs on the device: connect it over USB and try again');
  const device = await connectDevice();
  if (!device) throw new ConnectSignerError('could not connect to the NeuraiHW device');
  const result = await withDevice(async () => {
    const probe = await device.ping();
    if (probe.device !== 'NeuraiHW') throw new ConnectSignerError('the connected device is not a NeuraiHW hardware wallet');
    return device.signMessage(message);
  });
  if (!result.signature) throw new ConnectSignerError('the device did not return a signature');
  if (result.address !== address) {
    throw new ConnectSignerError(
      `the connected device is not the one this wallet was added from: it signs with ${result.address}, the session uses ${address}`,
    );
  }
  return result.signature;
}

/**
 * Signs `message` with the key of `address`, which must belong to `wallet`.
 * The signature is verified locally before it is returned: a wallet must never
 * hand a web site something that will not check out.
 */
export async function signConnectMessage(
  wallet: AbstractNeuraiWallet,
  address: string,
  message: string,
  options: ConnectSignOptions = {},
): Promise<ConnectSignature> {
  if (!address) throw new ConnectSignerError('no address to sign with');

  // `type` is declared as the literal 'abstract' on the base class (see
  // `asConnectWallet` in screen/connect/logic.ts), hence the widening.
  if ((wallet.type as string) === HARDWARE_WALLET_TYPE) {
    const signature = await signWithDevice(options.connectDevice, address, message);
    if (!verifyMessage(message, address, signature)) {
      throw new ConnectSignerError('the signature the device produced does not verify against the address');
    }
    return { signature, type: signatureTypeForAddress(address), address };
  }

  const material = await wallet.getMessageSigningMaterial(address);
  if (!material) throw new ConnectSignerError('this wallet cannot sign messages for that address');

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
