/**
 * `signPsbt` for Neurai Connect (neurai-walletconnect-spec, methods/signPsbt.json).
 *
 * A site builds the transaction, sends it as a PSBT and names the inputs this
 * wallet must sign. Before anything is signed the wallet has to be able to
 * show what the transaction does (spec/session.md section 3.4): where every
 * output goes, which outputs come back to this wallet, and the fee. So the
 * request is first *inspected*, and refused when it cannot be shown or must
 * not be signed:
 *
 * - every prevout travels as `nonWitnessUtxo`, and its txid must be the one
 *   the input spends, so amounts and the fee are the real ones;
 * - every input to sign must be spent from an address of this wallet, and
 *   the address the site names must be the one the prevout pays;
 * - only SIGHASH_ALL is signed;
 * - post-quantum inputs are refused: a PSBT has no field for an ML-DSA-44
 *   signature;
 * - `broadcast: true` is refused: the wallet never publishes a site's
 *   transaction.
 *
 * Signing uses the wallet's own keys through `neurai-sign-transaction` on the
 * PSBT's unsigned transaction, and the signatures are handed back as
 * `partialSig` entries (compressed public key, DER signature followed by the
 * hash type byte). The site finalizes: a P2PKH scriptSig, or the strict ECDSA
 * witness v3 template `[0x02, sig, pubkey, 0x51]`.
 *
 * Only package imports, so the module can be loaded outside the app (the
 * extension's end-to-end test signs with it).
 */

import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { classifyScriptPubKey, WITNESS_FAMILIES } from '@neuraiproject/neurai-create-transaction';
import { sign as signTransaction } from '@neuraiproject/neurai-sign-transaction';
import type { NeuraiSigningMaterial } from '../../../class/wallets/abstract-neurai-wallet';

/** SIGHASH_ALL, the only type this wallet signs for a site. */
export const PSBT_SIGHASH_ALL = 1;

/** Error codes of methods/signPsbt.json. */
export const PSBT_ERROR_UNAUTHORIZED = 4100;
export const PSBT_ERROR_INVALID = 5001;

/** What the wallet needs to know to inspect and sign a PSBT. */
export interface PsbtWallet {
  weOwnAddress(address: string): boolean;
  getMessageSigningMaterial(address: string): Promise<NeuraiSigningMaterial | false>;
}

export interface SignPsbtParams {
  account?: string;
  psbt: string;
  signInputs: Array<{ address: string; index: number; sighashTypes?: number[] }>;
  broadcast?: boolean;
}

export interface PsbtAssetAmount {
  name: string;
  /** Exact decimal text (8 decimals at most). Absent for an owner token, which is always one unit. */
  amount?: string;
  /** `transfer`, `issue`, `reissue` or `owner`. */
  operation: string;
}

export interface PsbtOutputSummary {
  index: number;
  /** Destination address, or null when the script pays no address (data, burn of unknown shape…). */
  address: string | null;
  scriptHex: string;
  sats: bigint;
  /** True when the output pays an address of this wallet (change, or a payment to itself). */
  ownAddress: boolean;
  asset: PsbtAssetAmount | null;
}

export interface PsbtInspection {
  inputCount: number;
  /** Inputs this wallet is asked to sign, with the address that pays each prevout. */
  toSign: Array<{ index: number; address: string; sats: bigint }>;
  outputs: PsbtOutputSummary[];
  /** XNA leaving the wallet: inputs it signs minus outputs coming back to it. */
  spentSats: bigint;
  /** Fee of the whole transaction (all inputs carry their prevout). */
  feeSats: bigint;
}

/** A request that cannot be shown or must not be signed, with the code to answer it with. */
export class PsbtRequestError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'PsbtRequestError';
    this.code = code;
  }
}

const invalid = (message: string) => new PsbtRequestError(PSBT_ERROR_INVALID, message);

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** The address a scriptPubKey pays (ignoring an asset suffix), or null. */
export function scriptToAddress(script: Uint8Array | string, testnet: boolean): string | null {
  const kind = classifyScriptPubKey(typeof script === 'string' ? script : toHex(script));
  if (!kind.program) return null;
  if (kind.type === 'p2pkh') return bitcoin.address.toBase58Check(kind.program, testnet ? 127 : 53);
  const family = WITNESS_FAMILIES.find(f => f.type === kind.type);
  if (!family || kind.witnessVersion === undefined) return null;
  return bitcoin.address.toBech32(kind.program, kind.witnessVersion, testnet ? family.hrp.testnet : family.hrp.mainnet);
}

const ASSET_OPERATIONS: Record<string, string> = { t: 'transfer', q: 'issue', r: 'reissue', o: 'owner' };

function readCompactSize(bytes: Uint8Array, offset: number): { value: number; size: number } {
  const first = bytes[offset];
  if (first < 0xfd) return { value: first, size: 1 };
  if (first === 0xfd) return { value: bytes[offset + 1] + bytes[offset + 2] * 256, size: 3 };
  throw invalid('asset payload too long');
}

function rawToDecimal(raw: bigint): string {
  const whole = raw / 100000000n;
  const fraction = (raw % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * The asset an output carries: `OP_XNA_ASSET <payload> OP_DROP` after the
 * destination, with the payload `marker (rvn|xna) · type · name · amount`.
 * Null for a plain XNA output; an undecodable payload is reported as such
 * rather than hidden.
 */
export function decodeAssetSuffix(script: Uint8Array): PsbtAssetAmount | null {
  const kind = classifyScriptPubKey(toHex(script));
  if (!kind.hasSuffix) return null;
  const prefixLength = kind.type === 'p2pkh' ? 25 : 34;
  try {
    if (script[prefixLength] !== 0xc0) throw invalid('not an asset suffix');
    let offset = prefixLength + 1;
    let length = script[offset];
    offset += 1;
    if (length === 0x4c) {
      length = script[offset];
      offset += 1;
    }
    const payload = script.subarray(offset, offset + length);
    const marker = Buffer.from(payload.subarray(0, 3)).toString('latin1');
    if (marker !== 'rvn' && marker !== 'xna') throw invalid('unknown asset marker');
    const operation = ASSET_OPERATIONS[String.fromCharCode(payload[3])] ?? 'unknown';
    const nameLength = readCompactSize(payload, 4);
    const nameStart = 4 + nameLength.size;
    const name = Buffer.from(payload.subarray(nameStart, nameStart + nameLength.value)).toString('utf8');
    if (operation === 'owner') return { name, operation };
    const amountBytes = payload.subarray(nameStart + nameLength.value, nameStart + nameLength.value + 8);
    if (amountBytes.length !== 8) return { name, operation };
    const raw = Buffer.from(amountBytes).readBigUInt64LE(0);
    return { name, amount: rawToDecimal(raw), operation };
  } catch {
    return { name: '?', operation: 'unknown' };
  }
}

function parseParams(params: unknown): SignPsbtParams {
  const p = (params ?? {}) as Partial<SignPsbtParams>;
  if (typeof p.psbt !== 'string' || p.psbt.length === 0) throw invalid('missing psbt');
  if (!Array.isArray(p.signInputs) || p.signInputs.length === 0) throw invalid('signInputs is empty');
  for (const entry of p.signInputs) {
    if (!entry || typeof entry.address !== 'string' || !Number.isSafeInteger(entry.index) || entry.index < 0) {
      throw invalid('malformed signInputs entry');
    }
    if (entry.sighashTypes !== undefined && (!Array.isArray(entry.sighashTypes) || entry.sighashTypes.some(t => t !== PSBT_SIGHASH_ALL))) {
      throw invalid('only SIGHASH_ALL is signed');
    }
  }
  if (new Set(p.signInputs.map(e => e.index)).size !== p.signInputs.length) throw invalid('an input is listed twice');
  if (p.broadcast === true) throw new PsbtRequestError(PSBT_ERROR_INVALID, 'this wallet does not broadcast a site’s transaction');
  return p as SignPsbtParams;
}

function decodePsbt(base64: string): bitcoin.Psbt {
  try {
    return bitcoin.Psbt.fromBase64(base64);
  } catch (error) {
    throw invalid(`not a PSBT: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The prevout an input spends, read from its `nonWitnessUtxo` after checking it is the right transaction. */
function prevoutOf(psbt: bitcoin.Psbt, index: number): { script: Uint8Array; sats: bigint } {
  const input = psbt.data.inputs[index];
  const txInput = psbt.txInputs[index];
  if (!input?.nonWitnessUtxo || !txInput) throw invalid(`input ${index} carries no previous transaction`);
  const prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
  if (toHex(prevTx.getHash()) !== toHex(txInput.hash)) throw invalid(`input ${index}: the previous transaction is not the one it spends`);
  const out = prevTx.outs[txInput.index];
  if (!out) throw invalid(`input ${index}: the previous transaction has no output ${txInput.index}`);
  return { script: out.script, sats: BigInt(out.value) };
}

/**
 * Decode and check a `signPsbt` request against this wallet. Throws a
 * `PsbtRequestError` (with the code to answer) when it must be refused.
 */
export function inspectSignPsbt(params: unknown, wallet: PsbtWallet, testnet: boolean): PsbtInspection {
  const request = parseParams(params);
  const psbt = decodePsbt(request.psbt);

  const toSign = request.signInputs.map(entry => {
    if (entry.index >= psbt.inputCount) throw invalid(`there is no input ${entry.index}`);
    const prevout = prevoutOf(psbt, entry.index);
    const address = scriptToAddress(prevout.script, testnet);
    if (address !== entry.address) throw invalid(`input ${entry.index} is not paid to ${entry.address}`);
    const kind = classifyScriptPubKey(toHex(prevout.script)).type;
    if (kind !== 'p2pkh' && kind !== 'ecdsa') {
      throw new PsbtRequestError(PSBT_ERROR_INVALID, `input ${entry.index} needs a ${kind} signature, which a PSBT cannot carry`);
    }
    if (!wallet.weOwnAddress(address)) {
      throw new PsbtRequestError(PSBT_ERROR_UNAUTHORIZED, `${address} is not an address of this wallet`);
    }
    return { index: entry.index, address, sats: prevout.sats };
  });

  let totalIn = 0n;
  for (let index = 0; index < psbt.inputCount; index++) totalIn += prevoutOf(psbt, index).sats;

  // Read from the unsigned transaction: `psbt.txOutputs` decodes every script
  // as a Bitcoin address and warns about "future segwit versions" for v2/v3.
  const unsignedTx = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  const outputs: PsbtOutputSummary[] = unsignedTx.outs.map((out, index) => {
    const address = scriptToAddress(out.script, testnet);
    return {
      index,
      address,
      scriptHex: toHex(out.script),
      sats: BigInt(out.value),
      ownAddress: address !== null && wallet.weOwnAddress(address),
      asset: decodeAssetSuffix(out.script),
    };
  });
  const totalOut = outputs.reduce((sum, o) => sum + o.sats, 0n);
  if (totalOut > totalIn) throw invalid('the outputs spend more than the inputs bring');

  const signedIn = toSign.reduce((sum, i) => sum + i.sats, 0n);
  const backToUs = outputs.filter(o => o.ownAddress).reduce((sum, o) => sum + o.sats, 0n);

  return {
    inputCount: psbt.inputCount,
    toSign,
    outputs,
    spentSats: signedIn > backToUs ? signedIn - backToUs : 0n,
    feeSats: totalIn - totalOut,
  };
}

/**
 * Sign the inputs of a request already inspected and shown to the user.
 * Returns the PSBT, base64, with one `partialSig` per signed input.
 */
export async function signPsbtWithWallet(params: unknown, wallet: PsbtWallet, testnet: boolean): Promise<string> {
  const inspection = inspectSignPsbt(params, wallet, testnet);
  const request = params as SignPsbtParams;
  const psbt = decodePsbt(request.psbt);

  const keys: Record<string, string> = {};
  for (const { address } of inspection.toSign) {
    if (keys[address]) continue;
    const material = await wallet.getMessageSigningMaterial(address);
    if (!material || material.kind !== 'legacy') throw new PsbtRequestError(PSBT_ERROR_UNAUTHORIZED, `no key for ${address}`);
    keys[address] = material.wif;
  }

  const utxos = inspection.toSign.map(({ index, address }) => {
    const txInput = psbt.txInputs[index];
    const prevout = prevoutOf(psbt, index);
    return {
      address,
      assetName: 'XNA',
      txid: toHex(Uint8Array.from(txInput.hash).reverse()),
      outputIndex: txInput.index,
      script: toHex(prevout.script),
      satoshis: prevout.sats.toString(),
      value: prevout.sats.toString(),
    };
  });

  const unsignedHex = toHex(psbt.data.globalMap.unsignedTx.toBuffer());
  // Only the chain matters to the signer; the key decides the template from each prevout.
  const signedHex = signTransaction(testnet ? 'xna-legacy-test' : 'xna-legacy', unsignedHex, utxos, keys, { debug: false });
  const signed = bitcoin.Transaction.fromHex(signedHex);

  for (const { index } of inspection.toSign) {
    const input = signed.ins[index];
    let signature: Uint8Array | undefined;
    let pubkey: Uint8Array | undefined;
    if (input.script.length > 0) {
      const chunks = bitcoin.script.decompile(input.script) ?? [];
      signature = chunks[0] instanceof Uint8Array ? chunks[0] : undefined;
      pubkey = chunks[1] instanceof Uint8Array ? chunks[1] : undefined;
    } else if (input.witness.length === 4) {
      signature = input.witness[1];
      pubkey = input.witness[2];
    }
    if (!signature || !pubkey || pubkey.length !== 33) throw invalid(`input ${index} could not be signed`);
    psbt.updateInput(index, { partialSig: [{ pubkey: Buffer.from(pubkey), signature: Buffer.from(signature) }] });
  }
  return psbt.toBase64();
}
