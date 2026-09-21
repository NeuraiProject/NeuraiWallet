import { createPaymentTransaction, createStandardAssetTransferTransaction } from '@neuraiproject/neurai-create-transaction';
import { estimateVirtualSize } from '@neuraiproject/neurai-sign-transaction';
import { xnaToSats } from './amounts';

type FeeOutput = string | { address: string; assetName: string };

/** Serialize the actual output shapes, including asset payloads and varints.
 * The signing library supplies conservative signature/witness sizes.
 * Placeholder outpoints and zero values have the same encoded size as real ones.
 */
export const estimateNeuraiTxSizeKb = (inputScripts: (string | undefined)[], outputs: FeeOutput[]): number => {
  const inputs = inputScripts.map((_, vout) => ({ txid: '00'.repeat(32), vout }));
  const payments = outputs.filter((o): o is string => typeof o === 'string').map(address => ({ address, valueSats: 0n }));
  const transfers = outputs.filter((o): o is Exclude<FeeOutput, string> => typeof o !== 'string').map(o => ({ ...o, amountRaw: 0n }));
  const built = transfers.length
    ? createStandardAssetTransferTransaction({ inputs, payments, transfers })
    : createPaymentTransaction({ inputs, payments });
  const utxos = inputs.map((input, i) => ({
    ...input,
    outputIndex: input.vout,
    script: inputScripts[i] ?? '',
    address: '',
    satoshis: 0,
    value: 0,
    assetName: 'XNA',
  }));
  return estimateVirtualSize('xna', built.rawTx, utxos) / 1000;
};

/** XNA per decimal kB; integer ceiling avoids floating-point fee rounding. */
export const estimateNeuraiFeeSats = (inputScripts: (string | undefined)[], outputs: FeeOutput[], feeRateXnaPerKb: number): bigint => {
  if (!Number.isFinite(feeRateXnaPerKb) || feeRateXnaPerKb < 0) throw new Error('Invalid fee rate');
  const vbytes = Math.round(estimateNeuraiTxSizeKb(inputScripts, outputs) * 1000);
  return (BigInt(vbytes) * xnaToSats(String(feeRateXnaPerKb)) + 999n) / 1000n;
};
