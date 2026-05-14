/**
 * Base class for Neurai wallets.
 *
 * Wraps `@neuraiproject/neurai-jswallet` (key derivation, address scanning,
 * transaction building) and delegates all network access to a `NeuraiBackend`
 * (RPC today, ElectrumX in the future). Subclasses fix the chain kind
 * (`legacy` ECDSA vs `pq` ML-DSA-44).
 *
 * Persistence shape: extends `AbstractWallet` so `class/blue-app.ts` keeps
 * deserializing wallets via `fromJson` without changes. The engine and
 * backend are runtime-only and marked non-enumerable so they never end up in
 * the persisted JSON.
 */

import NeuraiJsWallet from '@neuraiproject/neurai-jswallet';
import NeuraiKey from '@neuraiproject/neurai-key';
import { getHistory, type IDelta, type IHistoryItem } from '@neuraiproject/neurai-history-list';

import {
  CHAIN_PARAMS,
  DEFAULT_NETWORK,
  NeuraiChainType,
  NeuraiNetwork,
  WalletKind,
  chainFor,
  createDefaultRpcBackend,
  isPQChain,
  type NeuraiBackend,
} from '../../blue_modules/neurai';
import { AbstractWallet } from './abstract-wallet';
import { Transaction, Utxo } from './types';

type NeuraiEngine = Awaited<ReturnType<typeof NeuraiJsWallet.createInstance>>;

const ONE_FULL_COIN = 1e8;
const FEE_TARGET_BLOCKS = 6;

export interface NeuraiTransactionTarget {
  address: string;
  /** Amount in XNA (full units, not satoshis). */
  amount: number;
}

export interface NeuraiBuildTransactionResult {
  /** Signed raw transaction hex, ready to broadcast. */
  signedHex: string;
  /** Unsigned raw transaction hex (pre-signature). */
  unsignedHex: string;
  /** Total fee in XNA full units. */
  fee: number;
  /** Engine-level debug payload (inputs, outputs, change, etc.). */
  debug: unknown;
}

export abstract class AbstractNeuraiWallet extends AbstractWallet {
  /** Chain identifier passed to the underlying engine. Persisted. */
  network: NeuraiChainType;
  /** Optional BIP39 passphrase ("25th word"). Persisted. */
  passphrase: string;
  /** Highest derivation index ever seen. Persisted; used to skip RPC scan. */
  addressPosition: number;
  /** Cached `IHistoryItem[]` for the wallet list view. Not persisted. */
  protected _historyItems: IHistoryItem[];
  /** Cached lightweight transactions for `getTransactions()`. Not persisted. */
  protected _txCache: Transaction[];

  /** Lazy engine + backend; created on first use, cleared on network change. */
  private _engine: NeuraiEngine | null;
  private _backend: NeuraiBackend | null;

  abstract get walletKind(): WalletKind;

  constructor() {
    super();
    this.network = chainFor(DEFAULT_NETWORK, 'legacy');
    this.passphrase = '';
    this.addressPosition = 0;
    this._historyItems = [];
    this._txCache = [];
    this._engine = null;
    this._backend = null;

    // Hide non-serializable runtime caches from JSON.stringify so they never
    // end up in persisted wallet JSON.
    Object.defineProperty(this, '_engine', { writable: true, enumerable: false, value: null });
    Object.defineProperty(this, '_backend', { writable: true, enumerable: false, value: null });
    Object.defineProperty(this, '_historyItems', { writable: true, enumerable: false, value: [] });
    Object.defineProperty(this, '_txCache', { writable: true, enumerable: false, value: [] });
  }

  // ---------- network / passphrase ------------------------------------------------

  setNetwork(network: NeuraiChainType): void {
    if (network === this.network) return;
    this._enforceChainKind(network);
    this.network = network;
    this._engine = null;
    this._backend = null;
    this.balance = 0;
    this.unconfirmed_balance = 0;
    this.addressPosition = 0;
    this._historyItems = [];
    this._txCache = [];
  }

  getNetwork(): NeuraiChainType {
    return this.network;
  }

  getNeuraiNetwork(): NeuraiNetwork {
    return CHAIN_PARAMS[this.network].network;
  }

  setPassphrase(passphrase: string): void {
    this.passphrase = passphrase || '';
    this._engine = null;
  }

  /**
   * Generate a fresh BIP39 mnemonic and store it as this wallet's `secret`.
   * Uses `NeuraiKey.generateMnemonic()` so the wordlist matches what the
   * import flow expects.
   */
  generate(): string {
    const mnemonic = NeuraiKey.generateMnemonic();
    this.setSecret(mnemonic);
    return mnemonic;
  }

  getPassphrase(): string {
    return this.passphrase;
  }

  protected _enforceChainKind(network: NeuraiChainType): void {
    const want = this.walletKind;
    const got = isPQChain(network) ? 'pq' : 'legacy';
    if (want !== got) {
      throw new Error(`Wallet kind mismatch: ${this.type} expects ${want}, got network ${network}`);
    }
  }

  // ---------- engine / backend ----------------------------------------------------

  protected async ensureEngine(): Promise<NeuraiEngine> {
    if (this._engine) return this._engine;
    if (!this.secret) {
      throw new Error('Cannot initialise Neurai engine: wallet has no mnemonic');
    }
    this._enforceChainKind(this.network);
    const engine = await NeuraiJsWallet.createInstance({
      mnemonic: this.secret,
      passphrase: this.passphrase || undefined,
      network: this.network,
      offlineMode: true,
      minAmountOfAddresses: Math.max(1, this.addressPosition),
    });
    this._engine = engine;
    return engine;
  }

  setBackend(backend: NeuraiBackend): void {
    if (backend.chain !== this.network) {
      throw new Error(`Backend chain ${backend.chain} does not match wallet network ${this.network}`);
    }
    this._backend = backend;
  }

  getBackend(): NeuraiBackend {
    if (!this._backend) {
      this._backend = createDefaultRpcBackend(this.getNeuraiNetwork(), this.walletKind);
    }
    return this._backend;
  }

  // ---------- addresses ------------------------------------------------------------

  async getReceiveAddressAsync(): Promise<string> {
    const engine = await this.ensureEngine();
    return engine.getReceiveAddress();
  }

  async getStaticReceiveAddress(): Promise<string> {
    const engine = await this.ensureEngine();
    const addrs = engine.getAddresses();
    if (addrs.length === 0) throw new Error('Engine has no addresses');
    // Mark this address as the active receive so the engine excludes it when
    // picking a change address; otherwise getChangeAddress() can return the
    // same index and trip "Change address cannot be the same as to address".
    (engine as unknown as { receiveAddress: string }).receiveAddress = addrs[0];
    return addrs[0];
  }

  // The Bitcoin pipeline (ReceiveDetails, deeplink router, push-notifications)
  // calls `getAddress()` synchronously and `getAddressAsync()` for the slow
  // path. Wire both to the engine so freshly-created Neurai wallets show a QR
  // and copyable address as soon as they're prewarmed.
  getAddress(): string | false | undefined {
    if (!this._engine) return false;
    try {
      const addrs = this._engine.getAddresses();
      return addrs[0] ?? false;
    } catch {
      return false;
    }
  }

  async getAddressAsync(): Promise<string | false | undefined> {
    return this.getReceiveAddressAsync();
  }

  async getChangeAddressAsync(): Promise<string> {
    const engine = await this.ensureEngine();
    return engine.getChangeAddress();
  }

  async getAddressesAsync(): Promise<string[]> {
    const engine = await this.ensureEngine();
    return engine.getAddresses();
  }

  /**
   * Initialise the engine without waiting for any blocking operation.
   * Safe to call right after `generate()`/`setSecret()` so callers that need
   * synchronous address access (carousels, QR display) can read the cached
   * `_engine.getAddresses()` immediately afterwards.
   */
  async prewarmEngine(): Promise<void> {
    await this.ensureEngine();
  }

  /**
   * Synchronously returns engine-derived addresses if the engine has been
   * initialised; otherwise returns an empty array. Bitcoin-pipeline screens
   * call this without awaiting, so they get whatever is cached.
   */
  getCachedAddresses(): string[] {
    return this._engine ? this._engine.getAddresses() : [];
  }

  weOwnAddress(address: string): boolean {
    if (!this._engine) return false;
    return this._engine.getAddresses().includes(address);
  }

  /**
   * Validates that `address` is a syntactically correct Neurai address. Both
   * Base58Check (legacy `N…`/`t…`) and Bech32m (PQ `nq1…`/`tnq1…`) are
   * accepted regardless of the wallet's own kind so callers (clipboard
   * detection, deeplinks, send screen) can pre-validate without knowing
   * which wallet they'll route through.
   */
  isAddressValid(address: string): boolean {
    if (typeof address !== 'string' || address.length === 0) return false;
    if (address.startsWith('nq1') || address.startsWith('tnq1') || address.startsWith('NQ1') || address.startsWith('TNQ1')) {
      return /^[a-z0-9]+$/i.test(address.slice(address.toLowerCase().indexOf('1') + 1));
    }
    return /^[NtRr][1-9A-HJ-NP-Za-km-z]{25,42}$/.test(address);
  }

  // ---------- UTXO surface (compat shim) -------------------------------------------
  // The Bitcoin-era pipeline expects every wallet to expose the methods below.
  // For Neurai wallets we delegate to the engine's UTXO list and cache it on
  // `_utxo` (inherited from AbstractWallet) so existing consumers keep working.

  async fetchUtxo(): Promise<void> {
    const engine = await this.ensureEngine();
    const utxos = await engine.getUTXOs();
    this._utxo = utxos.map(u => ({
      height: u.height ?? 0,
      address: u.address,
      txid: u.txid,
      vout: u.outputIndex,
      value: u.satoshis,
      confirmations: u.height ? 1 : 0,
    })) as Utxo[];
  }

  getUtxo(_respectFrozen: boolean = false): Utxo[] {
    return this._utxo as Utxo[];
  }

  /**
   * Returns the WIF private key for an address owned by this wallet, or
   * `false` if the address is unknown or this is a PQ wallet (PQ keys do not
   * have a WIF representation).
   */
  _getWIFbyAddress(address: string): string | false {
    if (!this._engine) return false;
    try {
      const material = this._engine.getPrivateKeyByAddress(address);
      if (typeof material === 'string') return material;
    } catch {
      return false;
    }
    return false;
  }

  // The Bitcoin HD-wallet inflate/offload code in `class/blue-app.ts` pokes at
  // these caches directly. Provide empty objects so structural typing matches
  // even though Neurai wallets short-circuit out of those code paths.
  _txs_by_external_index: Record<number, Transaction[]> = {};
  _txs_by_internal_index: Record<number, Transaction[]> = {};

  // Heuristics the Bitcoin pipeline uses to throttle fetches. We always say
  // "yes, it's time" — `fetchBalance`/`fetchTransactions` are cheap RPC calls.
  timeToRefreshBalance(): boolean {
    return Date.now() - this._lastBalanceFetch > 5 * 60 * 1000;
  }

  timeToRefreshTransaction(): boolean {
    return Date.now() - this._lastTxFetch > 5 * 60 * 1000;
  }

  // Bitcoin HD wallets expose `addressIsChange` to mark internal addresses on
  // CoinControl. The Neurai engine differentiates external/internal via its
  // own derivation tree; for now we don't expose change addresses to coin
  // control so always answer false.
  addressIsChange(_address: string): boolean {
    return false;
  }

  // Custom coin selector. The Bitcoin pipeline checks for this on the wallet
  // and falls back to coinselect's default if absent. We do not expose one.
  coinselect: undefined;

  // ---------- balance / history ----------------------------------------------------

  async fetchBalance(): Promise<void> {
    const engine = await this.ensureEngine();
    const addresses = engine.getAddresses();
    const xnaBalance = await this.getBackend().getBalance(addresses);
    this.balance = Math.round(xnaBalance * ONE_FULL_COIN);
    this.unconfirmed_balance = 0;
    this._lastBalanceFetch = Date.now();
  }

  async fetchTransactions(): Promise<void> {
    const engine = await this.ensureEngine();
    const addresses = engine.getAddresses();
    const backend = this.getBackend();
    const deltas = (await backend.getAddressHistory(addresses)) as IDelta[];
    const baseCurrency = engine.getBaseCurrency();
    const items = getHistory(deltas, baseCurrency);
    const heights = Array.from(new Set(items.map(i => i.blockHeight).filter(h => h > 0)));
    let blockTimes: Record<number, number> = {};
    if (heights.length > 0) {
      try {
        blockTimes = await backend.getBlockTimes(heights);
      } catch (err) {
        console.debug('fetchTransactions: getBlockTimes failed', err);
      }
    }
    this._historyItems = items;
    this._txCache = items.map(item => this._historyItemToTransaction(item, deltas, blockTimes));
    this._lastTxFetch = Date.now();
  }

  getTransactions(): Transaction[] {
    return this._txCache;
  }

  /** Raw history items as returned by `@neuraiproject/neurai-history-list`. */
  getHistoryItems(): IHistoryItem[] {
    return this._historyItems;
  }

  // ---------- transactions ---------------------------------------------------------

  async buildSendTransaction(targets: NeuraiTransactionTarget[]): Promise<NeuraiBuildTransactionResult> {
    if (targets.length === 0) {
      throw new Error('buildSendTransaction requires at least one target');
    }
    const engine = await this.ensureEngine();

    if (targets.length === 1) {
      const result = await engine.createTransaction({
        toAddress: targets[0].address,
        amount: targets[0].amount,
      });
      return {
        signedHex: result.debug.signedTransaction ?? '',
        unsignedHex: result.debug.rawUnsignedTransaction ?? '',
        fee: result.debug.fee,
        debug: result.debug,
      };
    }

    const outputs: Record<string, number> = {};
    for (const t of targets) outputs[t.address] = t.amount;
    const result = await engine.createSendManyTransaction({ outputs });
    return {
      signedHex: result.debug.signedTransaction ?? '',
      unsignedHex: result.debug.rawUnsignedTransaction ?? '',
      fee: result.debug.fee,
      debug: result.debug,
    };
  }

  async broadcastTx(rawHex: string): Promise<string> {
    return this.getBackend().broadcast(rawHex);
  }

  /** Smart fee estimate in XNA/kB for the given confirmation depth. */
  async estimateFeeRate(targetBlocks: number = FEE_TARGET_BLOCKS): Promise<number> {
    const estimate = await this.getBackend().estimateFee(targetBlocks);
    return estimate.feeRateXnaPerKb;
  }

  // ---------- helpers --------------------------------------------------------------

  private _historyItemToTransaction(
    item: IHistoryItem,
    _deltas: IDelta[],
    blockTimes: Record<number, number>,
  ): Transaction {
    const xnaAsset = item.assets.find(a => a.assetName === 'XNA');
    const value = xnaAsset ? Math.round(xnaAsset.satoshis) : 0;
    // Mempool txs (height 0) get the current wall clock so the UI shows
    // "just now" instead of 1970. Confirmed txs use the block header time.
    const nowSec = Math.floor(Date.now() / 1000);
    const time = item.blockHeight > 0 ? blockTimes[item.blockHeight] ?? nowSec : nowSec;
    return {
      txid: item.transactionId,
      hash: item.transactionId,
      version: 0,
      size: 0,
      vsize: 0,
      weight: 0,
      locktime: 0,
      inputs: [],
      outputs: [],
      blockhash: '',
      confirmations: item.blockHeight > 0 ? 1 : 0,
      time,
      blocktime: time,
      timestamp: time,
      value: item.isSent ? -Math.abs(value) : Math.abs(value),
    };
  }

  // ---------- AbstractWallet `allow*` overrides ------------------------------------

  allowSend(): boolean {
    return true;
  }

  allowReceive(): boolean {
    return true;
  }

  allowRBF(): boolean {
    return false;
  }

  allowPayJoin(): boolean {
    return false;
  }

  allowSilentPaymentSend(): boolean {
    return false;
  }

  allowCosignPsbt(): boolean {
    return false;
  }

  allowSignVerifyMessage(): boolean {
    return false;
  }

  allowMasterFingerprint(): boolean {
    return false;
  }

  allowBIP47(): boolean {
    return false;
  }

  allowXpub(): boolean {
    return false;
  }

  async allowOnchainAddress(): Promise<boolean> {
    return true;
  }
}
