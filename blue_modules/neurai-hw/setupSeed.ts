/**
 * Helpers for provisioning an UNCONFIGURED NeuraiHW (ESP32) over USB.
 *
 * When a device boots with no seed stored, the phone can generate a BIP39
 * mnemonic and push it with `device.setupSeed(...)`. The device only ever shows
 * a summary (word count + network + key type) and the PIN is entered on-device —
 * so the phone is the ONLY place the actual words exist and the user MUST back
 * them up here.
 *
 * The firmware validates the BIP39 checksum against the English wordlist, so we
 * generate with `@neuraiproject/neurai-key` (English `@scure/bip39`) to match.
 */

import { entropyToMnemonic, isMnemonicValid } from '@neuraiproject/neurai-key';
import { randomBytes } from '../../class/rng';

export type SetupWordCount = 12 | 24;
export type SetupNetwork = 'mainnet' | 'testnet';
export type SetupKeyType = 'legacy' | 'pq';

/** 12 words = 128 bits = 16 bytes, 24 words = 256 bits = 32 bytes of entropy. */
export async function generateSetupMnemonic(words: SetupWordCount): Promise<string> {
  const entropy = await randomBytes(words === 24 ? 32 : 16);
  return entropyToMnemonic(entropy);
}

/** Collapse runs of whitespace, lowercase and trim — matches the firmware's own normalization. */
export function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Validate a user-typed recovery phrase for the `restore` path. The device only
 * accepts 12/24 English BIP39 words with a valid checksum (`isMnemonicValid`
 * uses the same English wordlist), so reject anything else here for fast
 * feedback before it reaches the device.
 */
export function validateSetupMnemonic(input: string): { valid: boolean; normalized: string; wordCount: number } {
  const normalized = normalizeMnemonic(input);
  const wordCount = normalized ? normalized.split(' ').length : 0;
  const valid = (wordCount === 12 || wordCount === 24) && isMnemonicValid(normalized);
  return { valid, normalized, wordCount };
}
