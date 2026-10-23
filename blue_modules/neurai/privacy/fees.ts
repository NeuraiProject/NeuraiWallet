/**
 * Automatic network fee for a pool operation.
 *
 * The fee is not free-form: each operation form accepts only the levels its
 * manifest pins (0.1, 0.2 and 0.5 XNA in the TEST pools), and the proof
 * commits to the chosen one. "Auto" picks the lowest level that covers the
 * transaction's size at the wallet's relay rate (feePolicy.ts: 0.01 XNA per
 * 1,000 vbytes plus 20%).
 */

import { xnaToSats } from '../amounts';
import { LOCAL_FEE_RATE_RPC } from '../feePolicy';

export const AUTO_FEE = 'auto';

/**
 * Upper bound of each form's transaction size in vbytes: about 15% over the
 * largest C6/C7 testnet transactions measured in October 2026 (D 4,838,
 * T2 5,341, T3 6,087, W 4,711, J2 5,143; T1 lies between D and T2).
 */
const FORM_VBYTES: Record<string, bigint> = { D: 5600n, T1: 5800n, T2: 6200n, T3: 7000n, W: 5500n, J2: 6000n };
const LARGEST_VBYTES = 7000n;

/** Atomic fee the relay rate asks for a transaction of this form. */
export function requiredPoolFee(form: string): bigint {
  const vbytes = FORM_VBYTES[form] ?? LARGEST_VBYTES;
  return (xnaToSats(LOCAL_FEE_RATE_RPC) * vbytes + 999n) / 1000n;
}

/** The lowest pinned level that covers `form`, or the highest one when none does. */
export function autoPoolFee(form: string, levels: string[]): string {
  if (!levels.length) return '';
  const sorted = [...levels].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  const required = requiredPoolFee(form);
  return sorted.find(level => BigInt(level) >= required) ?? sorted[sorted.length - 1];
}
