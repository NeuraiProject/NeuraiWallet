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
 * - the PSBT is read in the Neurai profile of neurai-create-transaction: every
 *   prevout travels as `nonWitnessUtxo` and its txid must be the one the input
 *   spends (a contradicting `witnessUtxo` is refused), so amounts and the fee
 *   are the real ones, version-3 transactions included;
 * - every input to sign must be spent from an address of this wallet, and
 *   the address the site names must be the one the prevout pays;
 * - the exception is the cancellation of one of this wallet's sell orders: an
 *   input whose `witnessScript` is a partial-fill covenant (see
 *   `inspectCancellation`) is signed through the covenant's cancel branch by
 *   the address the site names, which must hold the covenant's cancel key, and
 *   only when every token locked in the order comes back to this wallet;
 * - only SIGHASH_ALL is signed;
 * - post-quantum inputs are refused: NeuraiWallet does not sign ML-DSA-44
 *   inputs over Neurai Connect yet;
 * - `broadcast: true` is refused: the wallet never publishes a site's
 *   transaction.
 *
 * Signing uses the wallet's own keys through `signPsbt` of
 * `neurai-sign-transaction`: P2PKH and ECDSA witness v3 inputs come back as
 * `partialSig` entries for the site to finalize, a covenant cancellation as
 * its final witness.
 *
 * Only package imports, so the module can be loaded outside the app (the
 * extension's end-to-end test signs with it).
 */

import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import {
  classifyScriptPubKey,
  decodePsbt,
  encodeDestinationScript,
  getPsbtPreviousOutput,
  WITNESS_FAMILIES,
  type DecodedPsbt,
} from '@neuraiproject/neurai-create-transaction';
import { parsePartialFillScript, parsePartialFillScriptPQ } from '@neuraiproject/neurai-scripts';
import { signPsbt } from '@neuraiproject/neurai-sign-transaction';
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

/** One of this wallet's sell orders that the transaction cancels. */
export interface PsbtCancellation {
  /** Input that spends the order. */
  index: number;
  /** Address of this wallet whose key is the order's cancel key. */
  address: string;
  /** Asset and amount locked in the order, read from its previous output. */
  locked: PsbtAssetAmount & { amount: string };
}

export interface PsbtInspection {
  inputCount: number;
  /** Inputs this wallet is asked to sign, with the address whose key signs each one. */
  toSign: Array<{ index: number; address: string; sats: bigint }>;
  /** Orders of this wallet the transaction cancels (inputs also listed in `toSign`). */
  cancellations: PsbtCancellation[];
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

const sha256 = (bytes: Uint8Array): Uint8Array => bitcoin.crypto.sha256(bytes);

function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagHash = sha256(Buffer.from(tag, 'latin1'));
  return sha256(Buffer.concat([tagHash, tagHash, message]));
}

/** AuthScript commitment of a NoAuth output whose witness script is `script` (a covenant). */
function noAuthCommitment(script: Uint8Array): Uint8Array {
  return taggedHash('NeuraiAuthScript', Buffer.concat([Buffer.from([0x01, 0x00]), sha256(script)]));
}

/** AuthScript commitment of a strict ECDSA (witness v3) address whose key hashes to `pubKeyHash`. */
function ecdsaCommitment(pubKeyHash: Uint8Array): Uint8Array {
  return taggedHash('NeuraiAuthScript', Buffer.concat([Buffer.from([0x03, 0x02]), pubKeyHash, sha256(Buffer.from([0x51]))]));
}

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

/** Name, operation and raw amount of an asset suffix; null for a plain XNA output. Throws when undecodable. */
function readAssetSuffix(script: Uint8Array): { name: string; operation: string; raw?: bigint } | null {
  const kind = classifyScriptPubKey(toHex(script));
  if (!kind.hasSuffix) return null;
  const prefixLength = kind.type === 'p2pkh' ? 25 : 34;
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
  return { name, operation, raw: Buffer.from(amountBytes).readBigUInt64LE(0) };
}

/**
 * The asset an output carries: `OP_XNA_ASSET <payload> OP_DROP` after the
 * destination, with the payload `marker (rvn|xna) · type · name · amount`.
 * Null for a plain XNA output; an undecodable payload is reported as such
 * rather than hidden.
 */
export function decodeAssetSuffix(script: Uint8Array): PsbtAssetAmount | null {
  try {
    const asset = readAssetSuffix(script);
    if (!asset) return null;
    return asset.raw === undefined
      ? { name: asset.name, operation: asset.operation }
      : { name: asset.name, amount: rawToDecimal(asset.raw), operation: asset.operation };
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

function readPsbt(base64: string): DecodedPsbt {
  try {
    return decodePsbt(base64);
  } catch (error) {
    throw invalid(`not a valid PSBT: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The prevout an input spends, from its previous transaction, which the PSBT
 * reader has already checked to be the one the input spends.
 */
function prevoutOf(psbt: DecodedPsbt, index: number): { script: Uint8Array; sats: bigint } {
  if (psbt.inputs[index]?.previousTx === undefined) throw invalid(`input ${index} carries no previous transaction`);
  const out = getPsbtPreviousOutput(psbt, index);
  return { script: Buffer.from(out.scriptPubKeyHex, 'hex'), sats: out.valueSats };
}

/**
 * An input whose `witnessScript` is a covenant: accepted only as the
 * cancellation of one of this wallet's sell orders.
 *
 * - the previous output is the covenant's NoAuth AuthScript commitment;
 * - the covenant is a partial-fill order with an ECDSA cancel key, bound to
 *   input 0 (neurai-scripts >= 0.10.0);
 * - `address` is this wallet's and its key is the cancel key: the covenant's
 *   `sellerPubKeyHash` is the P2PKH hash of the address, or the key hash behind
 *   the commitment of an ECDSA witness v3 address;
 * - the order holds an asset (what is shown and checked to come back).
 */
function inspectCancellation(
  index: number,
  address: string,
  witnessScriptHex: string,
  prevout: { script: Uint8Array },
  wallet: PsbtWallet,
): PsbtCancellation {
  const witnessScript = Buffer.from(witnessScriptHex, 'hex');
  const kind = classifyScriptPubKey(toHex(prevout.script));
  if (kind.type !== 'authscript' || !kind.program || toHex(noAuthCommitment(witnessScript)) !== toHex(kind.program)) {
    throw invalid(`input ${index}: its witnessScript is not the script of the output it spends`);
  }
  let order: ReturnType<typeof parsePartialFillScript>;
  try {
    order = parsePartialFillScript(witnessScriptHex);
  } catch (error) {
    let pq = false;
    try {
      parsePartialFillScriptPQ(witnessScriptHex);
      pq = true;
    } catch {
      // neither kind of order
    }
    if (pq) {
      throw invalid(`input ${index} cancels an order with a post-quantum key, which this wallet does not sign over Neurai Connect`);
    }
    throw invalid(
      `input ${index}: its witnessScript is not a sell order this wallet can cancel (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!wallet.weOwnAddress(address)) {
    throw new PsbtRequestError(PSBT_ERROR_UNAUTHORIZED, `${address} is not an address of this wallet`);
  }
  const own = classifyScriptPubKey(toHex(encodeDestinationScript(address)));
  const keyHash = Buffer.from(order.sellerPubKeyHash);
  const holdsCancelKey =
    (own.type === 'p2pkh' && own.program && Buffer.from(own.program).equals(keyHash)) ||
    (own.type === 'ecdsa' && own.program && Buffer.from(own.program).equals(Buffer.from(ecdsaCommitment(keyHash))));
  if (!holdsCancelKey) {
    throw new PsbtRequestError(PSBT_ERROR_UNAUTHORIZED, `input ${index}: the order is not cancelled with the key of ${address}`);
  }
  let asset: ReturnType<typeof readAssetSuffix>;
  try {
    asset = readAssetSuffix(prevout.script);
  } catch {
    asset = null;
  }
  if (!asset || asset.raw === undefined) throw invalid(`input ${index}: the order holds no asset this wallet can read`);
  return { index, address, locked: { name: asset.name, amount: rawToDecimal(asset.raw), operation: asset.operation } };
}

/**
 * Decode and check a `signPsbt` request against this wallet. Throws a
 * `PsbtRequestError` (with the code to answer) when it must be refused.
 */
export function inspectSignPsbt(params: unknown, wallet: PsbtWallet, testnet: boolean): PsbtInspection {
  const request = parseParams(params);
  const psbt = readPsbt(request.psbt);
  const inputCount = psbt.unsignedTx.inputs.length;

  const cancellations: PsbtCancellation[] = [];
  const toSign = request.signInputs.map(entry => {
    if (entry.index >= inputCount) throw invalid(`there is no input ${entry.index}`);
    const prevout = prevoutOf(psbt, entry.index);
    const witnessScript = psbt.inputs[entry.index].witnessScript;
    if (witnessScript !== undefined) {
      cancellations.push(inspectCancellation(entry.index, entry.address, witnessScript, prevout, wallet));
      return { index: entry.index, address: entry.address, sats: prevout.sats };
    }
    const address = scriptToAddress(prevout.script, testnet);
    if (address !== entry.address) throw invalid(`input ${entry.index} is not paid to ${entry.address}`);
    const kind = classifyScriptPubKey(toHex(prevout.script)).type;
    if (kind !== 'p2pkh' && kind !== 'ecdsa') {
      throw new PsbtRequestError(
        PSBT_ERROR_INVALID,
        `input ${entry.index} needs a ${kind} signature, which this wallet does not sign over Neurai Connect`,
      );
    }
    if (!wallet.weOwnAddress(address)) {
      throw new PsbtRequestError(PSBT_ERROR_UNAUTHORIZED, `${address} is not an address of this wallet`);
    }
    return { index: entry.index, address, sats: prevout.sats };
  });

  let totalIn = 0n;
  for (let index = 0; index < inputCount; index++) totalIn += prevoutOf(psbt, index).sats;

  const assetsBack = new Map<string, bigint>();
  const outputs: PsbtOutputSummary[] = psbt.unsignedTx.outputs.map((out, index) => {
    const script = Buffer.from(out.scriptPubKeyHex, 'hex');
    const address = scriptToAddress(script, testnet);
    const ownAddress = address !== null && wallet.weOwnAddress(address);
    if (ownAddress) {
      try {
        const asset = readAssetSuffix(script);
        if (asset?.raw !== undefined) assetsBack.set(asset.name, (assetsBack.get(asset.name) ?? 0n) + asset.raw);
      } catch {
        // an undecodable suffix brings nothing back
      }
    }
    return { index, address, scriptHex: out.scriptPubKeyHex, sats: out.valueSats, ownAddress, asset: decodeAssetSuffix(script) };
  });
  const totalOut = outputs.reduce((sum, o) => sum + o.sats, 0n);
  if (totalOut > totalIn) throw invalid('the outputs spend more than the inputs bring');

  // A cancellation is one only if every token locked in the orders comes back to this wallet.
  const locked = new Map<string, bigint>();
  for (const c of cancellations) {
    const raw = readAssetSuffix(prevoutOf(psbt, c.index).script)!.raw!;
    locked.set(c.locked.name, (locked.get(c.locked.name) ?? 0n) + raw);
  }
  for (const [name, raw] of locked) {
    if ((assetsBack.get(name) ?? 0n) < raw) {
      throw invalid(`the cancelled order holds ${rawToDecimal(raw)} ${name}, but not all of it comes back to this wallet`);
    }
  }

  const signedIn = toSign.reduce((sum, i) => sum + i.sats, 0n);
  const backToUs = outputs.filter(o => o.ownAddress).reduce((sum, o) => sum + o.sats, 0n);

  return {
    inputCount,
    toSign,
    cancellations,
    outputs,
    spentSats: signedIn > backToUs ? signedIn - backToUs : 0n,
    feeSats: totalIn - totalOut,
  };
}

/**
 * Sign the inputs of a request already inspected and shown to the user.
 * Returns the PSBT, base64: a `partialSig` per P2PKH / ECDSA witness input, the
 * final witness of each cancelled order.
 */
export async function signPsbtWithWallet(params: unknown, wallet: PsbtWallet, testnet: boolean): Promise<string> {
  const inspection = inspectSignPsbt(params, wallet, testnet);
  const request = params as SignPsbtParams;

  const keys: Record<string, string> = {};
  for (const { address } of inspection.toSign) {
    if (keys[address]) continue;
    const material = await wallet.getMessageSigningMaterial(address);
    if (!material || material.kind !== 'legacy') throw new PsbtRequestError(PSBT_ERROR_UNAUTHORIZED, `no key for ${address}`);
    keys[address] = material.wif;
  }

  try {
    // Only the chain matters to the signer; the key decides the template from each prevout.
    return signPsbt(testnet ? 'xna-legacy-test' : 'xna-legacy', request.psbt, keys, {
      inputs: inspection.toSign.map(({ index, address }) => ({ index, address })),
      debug: false,
    });
  } catch (error) {
    throw invalid(`the transaction could not be signed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
