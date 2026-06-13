/**
 * Fee estimation for manually-assembled Neurai transactions.
 *
 * Mirrors the size/fee math in `@neuraiproject/neurai-jswallet`'s internal
 * `estimateSizeKB` so a transaction we build and sign ourselves — e.g. the
 * "send max" path, which bypasses the engine's `createTransaction` because that
 * always appends a change output and cannot express a zero-change spend — is
 * charged the same fee the engine would have applied for the same inputs and
 * outputs. Keep these constants in sync with that package.
 */

const LEGACY_INPUT_VBYTES = 148;
const PQ_INPUT_VBYTES = 976;
const LEGACY_OUTPUT_BYTES = 34;
const PQ_OUTPUT_BYTES = 31;
const SATS_PER_XNA = 100_000_000;

/** A PQ (ML-DSA-44 / AuthScript) prevout script is detected by the engine via
 * its `5114` prefix; mirror that exactly so our fee matches the engine's. */
const isPQScript = (script: string | undefined): boolean => script?.startsWith('5114') === true;

/** PQ destinations use the bech32 HRPs `nq` / `tnq`. */
const isPQAddress = (address: string): boolean => {
  const a = address.toLowerCase();
  return a.startsWith('nq1') || a.startsWith('tnq1');
};

/** Estimated serialized size in kB for the given input scripts and output addresses. */
export const estimateNeuraiTxSizeKb = (inputScripts: (string | undefined)[], outputAddresses: string[]): number => {
  const hasPQInputs = inputScripts.some(isPQScript);
  const baseSize = hasPQInputs ? 12 : 10;
  const inputBytes = inputScripts.reduce((total, script) => total + (isPQScript(script) ? PQ_INPUT_VBYTES : LEGACY_INPUT_VBYTES), 0);
  const outputBytes = outputAddresses.reduce((total, address) => total + (isPQAddress(address) ? PQ_OUTPUT_BYTES : LEGACY_OUTPUT_BYTES), 0);
  return (baseSize + inputBytes + outputBytes) / 1024;
};

/** Sub-satoshi tolerance so floating-point noise on an exactly-integer fee
 * (e.g. 937500.0000000002) does not get rounded up to a spurious extra sat. */
const SUB_SAT_EPSILON = 1e-6;

/**
 * Fee in satoshis for a transaction with the given input scripts and output
 * addresses at `feeRateXnaPerKb` (XNA per kilobyte, the unit the engine and the
 * backend's `estimateFee` use). Rounded up so we never under-pay the node.
 */
export const estimateNeuraiFeeSats = (inputScripts: (string | undefined)[], outputAddresses: string[], feeRateXnaPerKb: number): number => {
  const sizeKb = estimateNeuraiTxSizeKb(inputScripts, outputAddresses);
  return Math.ceil(sizeKb * feeRateXnaPerKb * SATS_PER_XNA - SUB_SAT_EPSILON);
};
