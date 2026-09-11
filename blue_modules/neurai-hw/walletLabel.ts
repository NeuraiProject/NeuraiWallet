/**
 * Naming of NeuraiHW hardware wallets.
 *
 * Every device reports the same readable type, so a second one would otherwise
 * get an identical name and the two become impossible to tell apart in the
 * wallet list. The default name therefore carries the device's master
 * fingerprint, which identifies the seed at a glance: `Neurai HW (a1b2c3d4)`.
 * Should a device not report one, the plain base name is used and numbered so
 * it still never collides. The user can overwrite the name on the pairing
 * screen, and later in the wallet details.
 *
 * This module has no imports on purpose: the wallet class pulls in the USB
 * signing library, which cannot be loaded by the unit tests.
 */

/** Readable type of `NeuraiHardwareWallet`. */
export const HARDWARE_WALLET_TYPE_READABLE = 'Neurai Hardware (USB)';

/** Base of every default wallet name. */
export const HARDWARE_WALLET_LABEL_BASE = 'Neurai HW';

export function defaultHardwareWalletLabel(masterFingerprint: string, takenLabels: string[]): string {
  const base = HARDWARE_WALLET_LABEL_BASE;
  const fingerprint = masterFingerprint.trim().toLowerCase();
  if (fingerprint) return `${base} (${fingerprint})`;

  const taken = new Set(takenLabels.map(l => l.trim()));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
