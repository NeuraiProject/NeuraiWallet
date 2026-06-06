/**
 * External-signing Neurai hardware wallet (NeuraiHW / ESP32 over USB).
 *
 * This is a watch-only wallet around a **single PQ (ML-DSA-44 AuthScript)
 * address**. The device exposes exactly one address and its public key; the
 * mobile app stores that and never holds a private key or mnemonic. Balance,
 * history and UTXOs are fetched per-address through the normal backend (no
 * engine bootstrap). Spending is done by building an unsigned transaction,
 * sending it to the device to sign, and broadcasting the result — that lands in
 * Phase 2b; for now `allowSend()` is false so the wallet is read-only.
 *
 * PQ addresses are reused (no change/derivation tree), so the single stored
 * address is the receive address, the change address, and the only address the
 * wallet watches.
 */

import NeuraiJsWallet from '@neuraiproject/neurai-jswallet';
import { Transaction } from 'bitcoinjs-lib';
import { buildUnsignedPQTransaction } from '@neuraiproject/neurai-sign-esp32/react-native';
import type { IAddressResponse, IDeviceInfo, IPQSignInput, IPQUTXO, NeuraiESP32 } from '@neuraiproject/neurai-sign-esp32/react-native';

import { chainFor, NeuraiChainType, WalletKind } from '../../blue_modules/neurai';
import { AbstractNeuraiWallet } from './abstract-neurai-wallet';

/** Unsigned PQ send ready to hand to the device for signing. */
export interface NeuraiHwUnsignedSend {
  /** Raw unsigned transaction hex. */
  rawTxHex: string;
  /** Per-input metadata for the device `sign_tx` request. */
  inputs: IPQSignInput[];
  /** Computed fee in satoshis (totalIn − totalOut). */
  feeSats: number;
}

/** Map a device `info.network` label + key type to an internal chain id. */
function chainForDevice(network: string | undefined): NeuraiChainType {
  const isTestnet = (network ?? '').toLowerCase().includes('test');
  return chainFor(isTestnet ? 'testnet' : 'mainnet', 'pq');
}

export class NeuraiHardwareWallet extends AbstractNeuraiWallet {
  static readonly type = 'NeuraiHardware';
  static readonly typeReadable = 'Neurai Hardware (USB)';
  // @ts-ignore: override
  public readonly type = NeuraiHardwareWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = NeuraiHardwareWallet.typeReadable;

  /** The device's single PQ address (`tnq1…`/`nq1…`). Persisted. */
  address: string;
  /** Raw ML-DSA-44 public key (hex). Persisted; used to verify device identity. */
  pubkey: string;
  /** 32-byte AuthScript commitment (hex) — the prevout scriptPubKey is `5120<commitment>`. */
  commitment: string;
  /** AuthScript witnessScript hex (phase 1: "51" = OP_TRUE). Persisted. */
  witnessScript: string;
  /** AuthScript auth type (1 = PQ). Persisted. */
  authType: number;
  /** Device derivation path, e.g. `m_pq/100'/1'/0'/0'/0'`. Persisted. */
  hwPath: string;
  /** Device master fingerprint (hex, e.g. "dbf8b520"). Persisted; identity check. */
  hwFingerprint: string;

  constructor() {
    super();
    this.address = '';
    this.pubkey = '';
    this.commitment = '';
    this.witnessScript = '51';
    this.authType = 1;
    this.hwPath = '';
    this.hwFingerprint = '';
    this.use_with_hardware_wallet = true;
    this.secret = '';
    // PQ-only device; default to testnet until populated from the device.
    this.network = chainFor('testnet', 'pq');
  }

  get walletKind(): WalletKind {
    return 'pq';
  }

  allowSweepFromWif(): boolean {
    return false;
  }

  /**
   * Sending is allowed, but unlike engine-backed wallets the signature comes
   * from the device. The send screen detects this wallet, builds the unsigned
   * transaction with {@link buildUnsignedSend}, signs it on the connected device
   * via {@link signWithDevice}, and broadcasts the result.
   */
  allowSend(): boolean {
    return true;
  }

  // ---------- no local engine ------------------------------------------------------

  // This wallet has no mnemonic and never derives or signs locally. Guard the
  // engine so any accidental code path fails loudly instead of throwing the
  // generic "no mnemonic" error from the base class.
  protected async ensureEngine(): Promise<never> {
    throw new Error('NeuraiHardwareWallet has no local engine; signing happens on the device');
  }

  // Address/UTXO/balance/history all operate on the single stored address,
  // fetched straight from the backend with no engine bootstrap.
  protected async _walletAddresses(): Promise<string[]> {
    return this.address ? [this.address] : [];
  }

  protected async _walletBaseCurrency(): Promise<string> {
    return NeuraiJsWallet.getBaseCurrencyByNetwork(this.network);
  }

  // ---------- address surface (single reused PQ address) ---------------------------

  getAddress(): string | false {
    return this.address || false;
  }

  async getAddressAsync(): Promise<string | false> {
    return this.address || false;
  }

  async getReceiveAddressAsync(): Promise<string> {
    return this.address;
  }

  async getStaticReceiveAddress(): Promise<string> {
    return this.address;
  }

  async getChangeAddressAsync(): Promise<string> {
    return this.address;
  }

  async getAddressesAsync(): Promise<string[]> {
    return this.address ? [this.address] : [];
  }

  getCachedAddresses(): string[] {
    return this.address ? [this.address] : [];
  }

  getAllExternalAddresses(): string[] {
    return this.getCachedAddresses();
  }

  weOwnAddress(address: string): boolean {
    return !!this.address && address === this.address;
  }

  // No engine to prewarm.
  async prewarmEngine(): Promise<void> {
    /* no-op: hardware wallet has no engine */
  }

  // ---------- device link ----------------------------------------------------------

  /**
   * Populate this wallet from a NeuraiHW `getInfo()` + `getAddress()` response.
   * `getAddress()` (PQ) carries the derived address, commitment, witnessScript
   * and authType; `getInfo()` carries the network and master fingerprint.
   */
  setFromDeviceInfo(info: IDeviceInfo, addr: IAddressResponse): void {
    this.network = chainForDevice(info.network);
    this.address = addr.address || info.address;
    this.pubkey = addr.pubkey || info.pubkey;
    this.commitment = addr.commitment ?? '';
    this.witnessScript = addr.witnessScript ?? '51';
    this.authType = addr.authType ?? 1;
    this.hwPath = addr.path || info.path || '';
    this.hwFingerprint = info.master_fingerprint || '';
    const fp = parseInt(this.hwFingerprint, 16);
    this.masterFingerprint = Number.isNaN(fp) ? 0 : fp;
    this._derivationPath = this.hwPath;
    if (!this.label) this.setLabel(NeuraiHardwareWallet.typeReadable);
    // Seed the persisted per-address status cache so the base class's PQ
    // fast-paths and backend subscription treat this as the single address.
    this._addressStatus = { [this.address]: '' };
  }

  /**
   * True if a freshly-read device identity matches the stored one. Used before
   * signing to refuse a different device than the wallet was created with.
   */
  matchesDevice(info: IDeviceInfo, addr?: IAddressResponse): boolean {
    if (this.hwFingerprint && info.master_fingerprint && info.master_fingerprint !== this.hwFingerprint) {
      return false;
    }
    const devicePubkey = addr?.pubkey || info.pubkey;
    if (this.pubkey && devicePubkey && devicePubkey !== this.pubkey) return false;
    const deviceAddress = addr?.address || info.address;
    if (this.address && deviceAddress && deviceAddress !== this.address) return false;
    return true;
  }

  // ---------- device-signed spending ----------------------------------------------

  /**
   * Build an unsigned PQ transaction spending this wallet's XNA UTXOs to
   * `toAddress`. Change returns to the wallet's own (reused) address. Does not
   * touch the device — pass the result to {@link signWithDevice} next.
   */
  async buildUnsignedSend(toAddress: string, amountSats: number, feeRate?: number): Promise<NeuraiHwUnsignedSend> {
    if (!this.address) throw new Error('Hardware wallet has no address');
    if (!Number.isFinite(amountSats) || amountSats <= 0) throw new Error('Invalid amount');

    const backend = this.getBackend();
    const rawUtxos = await backend.getUtxos([this.address]);
    const xnaUtxos = rawUtxos.filter(u => u.assetName === 'XNA' && u.satoshis > 0);
    if (xnaUtxos.length === 0) throw new Error('No spendable XNA UTXOs for this address');

    const utxos: IPQUTXO[] = xnaUtxos.map(u => ({
      txid: u.txid,
      vout: u.outputIndex,
      satoshis: u.satoshis,
      scriptPubKey: u.script,
      type: 'pq',
    }));

    let rate = feeRate;
    if (!rate || rate <= 0) {
      try {
        const xnaPerKb = await this.estimateFeeRate();
        rate = Math.max(1, Math.round((xnaPerKb * 1e8) / 1000));
      } catch {
        rate = 1024;
      }
    }

    const { rawTxHex, inputs } = buildUnsignedPQTransaction({
      utxos,
      outputs: [{ address: toAddress, value: amountSats }],
      changeAddress: this.address,
      feeRate: rate,
    });

    // Fee = totalIn − totalOut. The builder already baked the fee into the tx;
    // decoding is only to display it. Never let a decode hiccup block the send.
    let feeSats = 0;
    try {
      const totalIn = utxos.reduce((sum, u) => sum + u.satoshis, 0);
      const totalOut = Transaction.fromHex(rawTxHex).outs.reduce((sum, o) => sum + Number(o.value), 0);
      feeSats = totalIn - totalOut;
    } catch {
      feeSats = 0;
    }
    return { rawTxHex, inputs, feeSats };
  }

  /**
   * Sign an unsigned send on the connected device and return the
   * broadcast-ready raw transaction. Verifies the device identity
   * (fingerprint/pubkey/address) before signing so a different device cannot be
   * substituted for the one the wallet was created with.
   */
  async signWithDevice(device: NeuraiESP32, unsigned: NeuraiHwUnsignedSend): Promise<{ signedHex: string; txId: string }> {
    const info = await device.getInfo();
    if (!this.matchesDevice(info)) {
      throw new Error('Connected device does not match this wallet (identity mismatch)');
    }
    const result = await device.signPqRawTransaction({ txHex: unsigned.rawTxHex, inputs: unsigned.inputs });
    if (!result.txHex) throw new Error('Device did not return a signed transaction');
    return { signedHex: result.txHex, txId: result.txId };
  }
}
