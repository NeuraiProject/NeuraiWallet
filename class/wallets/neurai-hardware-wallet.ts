/**
 * External-signing Neurai hardware wallet (NeuraiHW / ESP32 over USB).
 *
 * Watch-only wallet over a device that holds the keys; the app never has a
 * mnemonic or private key. Two modes, by the device's `key_type`:
 *
 *  - **pq** (ML-DSA-44 / AuthScript): a SINGLE reused address (`nq1…`/`tnq1…`).
 *    The device exposes one pubkey; signing uses `sign_tx` (raw transaction).
 *
 *  - **legacy** (ECDSA P2PKH): a full **HD account** imported from the device's
 *    account xpub (`get_bip32_pubkey`, `m/44'/coin'/0'`). The app derives
 *    receive (`0/i`) and change (`1/i`) addresses from the xpub, discovers used
 *    ones by gap limit, and watches them all. Signing builds a PSBT with
 *    per-input derivation paths and uses `sign_psbt` (the device signs each
 *    input from its root key via the embedded paths).
 *
 * Balance / history / UTXOs are fetched per-address through the normal backend
 * (no engine bootstrap).
 */

import NeuraiJsWallet from '@neuraiproject/neurai-jswallet';
import { Buffer } from 'buffer';
import { Transaction } from 'bitcoinjs-lib';
import {
  buildPSBTFromRawTransaction,
  buildUnsignedPQTransaction,
  encodeDestinationScript,
  finalizeSignedPSBT,
} from '@neuraiproject/neurai-sign-esp32/react-native';
import type {
  IAddressResponse,
  IBip32PubkeyResponse,
  IDeviceInfo,
  IPQSignInput,
  IPQUTXO,
  IPSBTInputMetadata,
  NetworkType,
  NeuraiESP32,
} from '@neuraiproject/neurai-sign-esp32/react-native';

import { chainFor, createDefaultRpcBackend, NeuraiChainType, WalletKind, type NeuraiBackend } from '../../blue_modules/neurai';
import { AbstractNeuraiWallet } from './abstract-neurai-wallet';
import { deriveLegacyAddress } from '../../blue_modules/neurai-hw/xpubDerivation';

/** Gap limit for HD address discovery (consecutive unused before stopping). */
const GAP_LIMIT = 20;
/** Reuse a discovery result for this long to coalesce the balance/history/utxo burst. */
const DISCOVERY_TTL_MS = 8000;
/** Drop change below this many satoshis into the fee. */
const CHANGE_DUST_SATS = 1000;

interface AddrMeta {
  change: 0 | 1;
  index: number;
  pubkeyHex: string;
  /** Full BIP32 path, e.g. m/44'/1900'/0'/0/5. */
  path: string;
}

/** Unsigned send staged for the device. Shape depends on the key type. */
export interface NeuraiHwUnsignedSend {
  keyType: WalletKind;
  /** Computed fee in satoshis. */
  feeSats: number;
  /** PQ: raw unsigned transaction hex + per-input metadata for `sign_tx`. */
  rawTxHex?: string;
  inputs?: IPQSignInput[];
  /** Legacy: base64 PSBT for `sign_psbt`. */
  psbtBase64?: string;
}

function chainForDevice(network: string | undefined, keyType: WalletKind): NeuraiChainType {
  const isTestnet = (network ?? '').toLowerCase().includes('test');
  return chainFor(isTestnet ? 'testnet' : 'mainnet', keyType);
}

export class NeuraiHardwareWallet extends AbstractNeuraiWallet {
  static readonly type = 'NeuraiHardware';
  static readonly typeReadable = 'Neurai Hardware (USB)';
  // @ts-ignore: override
  public readonly type = NeuraiHardwareWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = NeuraiHardwareWallet.typeReadable;

  /** Device key type: `pq` or `legacy`. Persisted. */
  keyType: WalletKind;
  /** Primary address: the PQ address (pq) or the current receive address (legacy). Persisted. */
  address: string;
  /** Device public key (hex): raw ML-DSA-44 (pq) or compressed secp256k1 of the primary address (legacy). Persisted. */
  pubkey: string;
  /** PQ only: 32-byte AuthScript commitment (hex). Persisted. */
  commitment: string;
  /** PQ only: AuthScript witnessScript hex. Persisted. */
  witnessScript: string;
  /** PQ only: AuthScript auth type. Persisted. */
  authType: number;
  /** Device leaf derivation path (pq) / primary receive path (legacy). Persisted. */
  hwPath: string;
  /** Device master fingerprint (hex). Persisted; identity check + PSBT bip32. */
  hwFingerprint: string;
  /** Legacy only: account extended public key (`m/44'/coin'/0'`). Persisted. */
  xpub: string;
  /** Legacy only: account derivation path, e.g. `m/44'/1900'/0'`. Persisted. */
  accountPath: string;

  // Runtime-only HD caches (non-enumerable: never serialized).
  private _addrMeta!: Map<string, AddrMeta>;
  private _watched!: string[];
  private _receiveAddr!: string;
  private _changeAddr!: string;
  private _discoveredAt!: number;
  private _rpcBackend!: NeuraiBackend | null;

  constructor() {
    super();
    this.keyType = 'pq';
    this.address = '';
    this.pubkey = '';
    this.commitment = '';
    this.witnessScript = '51';
    this.authType = 1;
    this.hwPath = '';
    this.hwFingerprint = '';
    this.xpub = '';
    this.accountPath = '';
    this.use_with_hardware_wallet = true;
    this.secret = '';
    this.network = chainFor('testnet', 'pq');

    Object.defineProperty(this, '_addrMeta', { writable: true, enumerable: false, value: new Map() });
    Object.defineProperty(this, '_watched', { writable: true, enumerable: false, value: [] });
    Object.defineProperty(this, '_receiveAddr', { writable: true, enumerable: false, value: '' });
    Object.defineProperty(this, '_changeAddr', { writable: true, enumerable: false, value: '' });
    Object.defineProperty(this, '_discoveredAt', { writable: true, enumerable: false, value: 0 });
    Object.defineProperty(this, '_rpcBackend', { writable: true, enumerable: false, value: null });
  }

  get walletKind(): WalletKind {
    return this.keyType;
  }

  allowSweepFromWif(): boolean {
    return false;
  }

  allowSend(): boolean {
    return true;
  }

  // ---------- no local engine ------------------------------------------------------

  protected async ensureEngine(): Promise<never> {
    throw new Error('NeuraiHardwareWallet has no local engine; signing happens on the device');
  }

  protected async _walletAddresses(): Promise<string[]> {
    if (this.keyType === 'pq') return this.address ? [this.address] : [];
    await this._ensureDiscovered();
    return this._watched.length ? this._watched : this.address ? [this.address] : [];
  }

  protected async _walletBaseCurrency(): Promise<string> {
    return NeuraiJsWallet.getBaseCurrencyByNetwork(this.network);
  }

  // ---------- address surface ------------------------------------------------------

  getAddress(): string | false {
    return this.address || false;
  }

  async getAddressAsync(): Promise<string | false> {
    return this.getReceiveAddressAsync();
  }

  async getReceiveAddressAsync(): Promise<string> {
    if (this.keyType === 'pq') return this.address;
    await this._ensureDiscovered();
    return this._receiveAddr || this.address;
  }

  async getStaticReceiveAddress(): Promise<string> {
    return this.getReceiveAddressAsync();
  }

  async getChangeAddressAsync(): Promise<string> {
    if (this.keyType === 'pq') return this.address;
    await this._ensureDiscovered();
    return this._changeAddr || this._receiveAddr || this.address;
  }

  async getAddressesAsync(): Promise<string[]> {
    return this._walletAddresses();
  }

  getCachedAddresses(): string[] {
    if (this.keyType === 'pq') return this.address ? [this.address] : [];
    return this._watched.length ? this._watched : this.address ? [this.address] : [];
  }

  getAllExternalAddresses(): string[] {
    return this.getCachedAddresses();
  }

  weOwnAddress(address: string): boolean {
    if (this.keyType === 'pq') return !!this.address && address === this.address;
    return this._addrMeta.has(address) || address === this.address;
  }

  async prewarmEngine(): Promise<void> {
    /* no-op: hardware wallet has no engine */
  }

  // ---------- HD discovery (legacy) ------------------------------------------------

  /** Derive a legacy address + cache its metadata. */
  private _deriveAndCache(change: 0 | 1, index: number): { address: string; pubkeyHex: string } {
    const d = deriveLegacyAddress(this.xpub, this.network, change, index);
    this._addrMeta.set(d.address, {
      change,
      index,
      pubkeyHex: d.pubkeyHex,
      path: `${this.accountPath}/${change}/${index}`,
    });
    return { address: d.address, pubkeyHex: d.pubkeyHex };
  }

  /** Gap-limit scan one branch; returns the watched addresses and first-unused index. */
  private async _scanBranch(change: 0 | 1): Promise<{ addresses: string[]; firstUnusedIndex: number }> {
    const backend = this.getBackend();
    const addresses: string[] = [];
    let index = 0;
    let firstUnusedIndex = 0;
    let firstUnusedFound = false;
    let consecutiveUnused = 0;

    while (consecutiveUnused < GAP_LIMIT) {
      const batch: string[] = [];
      for (let i = 0; i < GAP_LIMIT; i++) batch.push(this._deriveAndCache(change, index + i).address);

      const deltas = await backend.getAddressHistory(batch);
      const used = new Set(deltas.map(d => d.address));
      for (let i = 0; i < batch.length; i++) {
        addresses.push(batch[i]);
        if (used.has(batch[i])) {
          consecutiveUnused = 0;
        } else {
          if (!firstUnusedFound) {
            firstUnusedIndex = index + i;
            firstUnusedFound = true;
          }
          consecutiveUnused++;
        }
      }
      index += GAP_LIMIT;
    }
    return { addresses, firstUnusedIndex };
  }

  /** Discover and cache the watched address window for the HD account. */
  private async _ensureDiscovered(): Promise<void> {
    if (this.keyType !== 'legacy' || !this.xpub) return;
    if (this._watched.length && Date.now() - this._discoveredAt < DISCOVERY_TTL_MS) return;

    const [external, internal] = await Promise.all([this._scanBranch(0), this._scanBranch(1)]);
    this._watched = [...external.addresses, ...internal.addresses];
    this._receiveAddr = this._deriveAndCache(0, external.firstUnusedIndex).address;
    this._changeAddr = this._deriveAndCache(1, internal.firstUnusedIndex).address;
    this.address = this._receiveAddr;
    this._discoveredAt = Date.now();
  }

  // ---------- device link ----------------------------------------------------------

  /**
   * Populate this wallet from device responses.
   * @param info  `getInfo()` — network, master fingerprint, key type.
   * @param addr  `getAddress()` — the leaf address/pubkey (and PQ commitment).
   * @param bip32 `get_bip32_pubkey()` — required for legacy: the account xpub.
   */
  setFromDeviceInfo(info: IDeviceInfo, addr: IAddressResponse, bip32?: IBip32PubkeyResponse): void {
    this.keyType = (addr.type ?? info.key_type ?? 'legacy') === 'pq' ? 'pq' : 'legacy';
    this.network = chainForDevice(info.network, this.keyType);
    this.address = addr.address || info.address;
    this.pubkey = addr.pubkey || info.pubkey;
    this.commitment = addr.commitment ?? '';
    this.witnessScript = addr.witnessScript ?? (this.keyType === 'pq' ? '51' : '');
    this.authType = addr.authType ?? 1;
    this.hwPath = addr.path || info.path || '';
    this.hwFingerprint = info.master_fingerprint || bip32?.master_fingerprint || '';
    const fp = parseInt(this.hwFingerprint, 16);
    this.masterFingerprint = Number.isNaN(fp) ? 0 : fp;
    this._derivationPath = this.hwPath;

    if (this.keyType === 'legacy') {
      this.xpub = bip32?.bip32_pubkey ?? '';
      this.accountPath = bip32?.path ?? '';
    }

    if (!this.label) this.setLabel(NeuraiHardwareWallet.typeReadable);
    this._addressStatus = { [this.address]: '' };
  }

  /** True if a freshly-read device identity matches the stored one. */
  matchesDevice(info: IDeviceInfo, addr?: IAddressResponse): boolean {
    if (this.hwFingerprint && info.master_fingerprint && info.master_fingerprint !== this.hwFingerprint) {
      return false;
    }
    const devicePubkey = addr?.pubkey || info.pubkey;
    if (this.pubkey && devicePubkey && devicePubkey !== this.pubkey) return false;
    return true;
  }

  // ---------- device-signed spending ----------------------------------------------

  async buildUnsignedSend(toAddress: string, amountSats: number, feeRate?: number): Promise<NeuraiHwUnsignedSend> {
    if (!Number.isFinite(amountSats) || amountSats <= 0) throw new Error('Invalid amount');
    const rate = await this._resolveFeeRate(feeRate);

    if (this.keyType === 'pq') return this._buildPqSend(toAddress, amountSats, rate);
    return this._buildLegacySend(toAddress, amountSats, rate);
  }

  private async _buildPqSend(toAddress: string, amountSats: number, rate: number): Promise<NeuraiHwUnsignedSend> {
    if (!this.address) throw new Error('Hardware wallet has no address');
    const rawUtxos = await this.getBackend().getUtxos([this.address]);
    const xnaUtxos = rawUtxos.filter(u => u.assetName === 'XNA' && u.satoshis > 0);
    if (xnaUtxos.length === 0) throw new Error('No spendable XNA UTXOs for this address');

    const utxos: IPQUTXO[] = xnaUtxos.map(u => ({
      txid: u.txid,
      vout: u.outputIndex,
      satoshis: u.satoshis,
      scriptPubKey: u.script,
      type: 'pq',
    }));
    const { rawTxHex, inputs } = buildUnsignedPQTransaction({
      utxos,
      outputs: [{ address: toAddress, value: amountSats }],
      changeAddress: this.address,
      feeRate: rate,
    });
    const totalIn = utxos.reduce((s, u) => s + u.satoshis, 0);
    const feeSats = this._feeFromTx(() => Transaction.fromHex(rawTxHex).outs.reduce((s, o) => s + Number(o.value), 0), totalIn);
    return { keyType: 'pq', rawTxHex, inputs, feeSats };
  }

  private async _buildLegacySend(toAddress: string, amountSats: number, rate: number): Promise<NeuraiHwUnsignedSend> {
    await this._ensureDiscovered();
    const backend = this.getBackend();
    const rawUtxos = await backend.getUtxos(this._watched);
    const utxos = rawUtxos
      .filter(u => u.assetName === 'XNA' && u.satoshis > 0 && this._addrMeta.has(u.address))
      .sort((a, b) => b.satoshis - a.satoshis);
    if (utxos.length === 0) throw new Error('No spendable XNA UTXOs');

    // Greedy coin selection; fee grows with the input count.
    const selected: typeof utxos = [];
    let inSats = 0;
    let fee = 0;
    for (const u of utxos) {
      selected.push(u);
      inSats += u.satoshis;
      fee = this._estimateLegacyFee(selected.length, 2, rate);
      if (inSats >= amountSats + fee) break;
    }
    if (inSats < amountSats + fee) throw new Error('Insufficient funds (including fee)');

    let changeSats = inSats - amountSats - fee;
    const changeAddr = await this.getChangeAddressAsync();

    // Build the unsigned raw transaction.
    const tx = new Transaction();
    tx.version = 2;
    for (const u of selected) tx.addInput(Buffer.from(u.txid, 'hex').reverse(), u.outputIndex);
    tx.addOutput(encodeDestinationScript(toAddress), BigInt(amountSats));
    if (changeSats > CHANGE_DUST_SATS) {
      tx.addOutput(encodeDestinationScript(changeAddr), BigInt(changeSats));
    } else {
      changeSats = 0; // dust → fold into fee
    }
    const rawUnsignedTransaction = tx.toHex();

    // Per-input metadata so the device can derive each signing key.
    const inputs: IPSBTInputMetadata[] = [];
    for (const u of selected) {
      const meta = this._addrMeta.get(u.address)!;

      const rawTxHex = await this._fetchRawTx(u.txid);
      inputs.push({
        txid: u.txid,
        vout: u.outputIndex,
        rawTxHex,
        pubkey: meta.pubkeyHex,
        masterFingerprint: this.hwFingerprint,
        derivationPath: meta.path,
      });
    }

    const psbtBase64 = buildPSBTFromRawTransaction({
      network: this.network as NetworkType,
      rawUnsignedTransaction,
      inputs,
    });
    return { keyType: 'legacy', psbtBase64, feeSats: inSats - amountSats - changeSats };
  }

  async signWithDevice(device: NeuraiESP32, unsigned: NeuraiHwUnsignedSend): Promise<{ signedHex: string; txId: string }> {
    const info = await device.getInfo();
    if (!this.matchesDevice(info)) {
      throw new Error('Connected device does not match this wallet (identity mismatch)');
    }

    if (unsigned.keyType === 'pq') {
      const result = await device.signPqRawTransaction({ txHex: unsigned.rawTxHex!, inputs: unsigned.inputs! });
      if (!result.txHex) throw new Error('Device did not return a signed transaction');
      return { signedHex: result.txHex, txId: result.txId };
    }

    const signed = await device.signPsbt(unsigned.psbtBase64!);
    const { txHex, txId } = finalizeSignedPSBT(unsigned.psbtBase64!, signed.psbt, this.network as NetworkType);
    if (!txHex) throw new Error('Could not finalize the signed transaction');
    return { signedHex: txHex, txId };
  }

  // ---------- helpers --------------------------------------------------------------

  private async _resolveFeeRate(feeRate?: number): Promise<number> {
    if (feeRate && feeRate > 0) return feeRate;
    try {
      const xnaPerKb = await this.estimateFeeRate();
      return Math.max(1, Math.round((xnaPerKb * 1e8) / 1000));
    } catch {
      return 1024;
    }
  }

  /** Rough P2PKH size estimate: inputs*148 + outputs*34 + 10 (bytes). */
  private _estimateLegacyFee(inputs: number, outputs: number, satPerByte: number): number {
    return Math.ceil((inputs * 148 + outputs * 34 + 10) * satPerByte);
  }

  private _feeFromTx(sumOutputs: () => number, totalIn: number): number {
    try {
      return totalIn - sumOutputs();
    } catch {
      return 0;
    }
  }

  /** A node RPC backend for `getrawtransaction` — the default WSS backend has no
   * RPC passthrough for it. Created lazily. */
  private _getRpcBackend(): NeuraiBackend {
    if (!this._rpcBackend) {
      this._rpcBackend = createDefaultRpcBackend(this.getNeuraiNetwork(), this.walletKind);
    }
    return this._rpcBackend;
  }

  private async _fetchRawTx(txid: string): Promise<string> {
    // Legacy PSBT inputs need the full previous transaction (nonWitnessUtxo).
    // Fetch it from a node RPC backend (WSS doesn't expose getrawtransaction).
    const raw = await this._getRpcBackend().rpc<unknown>('getrawtransaction', [txid, false]);
    const hex = typeof raw === 'string' ? raw : (raw as { hex?: string } | null)?.hex;
    if (!hex) throw new Error(`Could not fetch previous transaction for input ${txid}`);
    return hex;
  }
}
