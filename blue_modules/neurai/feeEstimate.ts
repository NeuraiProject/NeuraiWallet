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
const PQ_INPUT_VBYTES = 977;
const LEGACY_OUTPUT_BYTES = 34;
const PQ_OUTPUT_BYTES = 43;
const SATS_PER_XNA = 100_000_000;

/**
 * A PQ (ML-DSA-44 / AuthScript) prevout script is `OP_1 <32-byte commitment>`,
 * i.e. it starts with `5120` (0x51 = OP_1, 0x20 = push-32). This matches the
 * signer's `isPQScript` in `@neuraiproject/neurai-sign-transaction`, the source
 * of truth for these sizes.
 *
 * NOTE: `@neuraiproject/neurai-jswallet`'s internal `isPQUTXO` checks the wrong
 * prefix (`5114`) and therefore sizes PQ inputs as legacy (148 vs 977 vbytes),
 * underpricing the fee below the node's min-relay floor ("66: min relay fee not
 * met"). We deliberately do NOT mirror that bug — that is exactly why asset
 * transfers and PQ send-max are assembled and priced here instead of via the
 * engine's `createTransaction`.
 */
const isPQScript = (script: string | undefined): boolean => script?.toLowerCase().startsWith('5120') === true;

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
