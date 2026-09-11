/**
 * Naming of NeuraiHW hardware wallets.
 *
 * Every device reports the same readable type, so a second one would otherwise
 * get an identical name and the two become impossible to tell apart in the
 * wallet list. The first device keeps the plain type name; the next ones get
 * the lowest free number appended. The user can still overwrite it on the
 * pairing screen, and later in the wallet details.
 *
 * This module has no imports on purpose: the wallet class pulls in the USB
 * signing library, which cannot be loaded by the unit tests.
 */

/** Readable type of `NeuraiHardwareWallet`, and the base of every default name. */
export const HARDWARE_WALLET_TYPE_READABLE = 'Neurai Hardware (USB)';

export function nextHardwareWalletLabel(takenLabels: string[]): string {
  const base = HARDWARE_WALLET_TYPE_READABLE;
  const taken = new Set(takenLabels.map(l => l.trim()));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
