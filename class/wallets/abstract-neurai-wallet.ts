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
import { type IDelta, type IHistoryItem } from '@neuraiproject/neurai-history-list';

import {
  CHAIN_PARAMS,
  DEFAULT_NETWORK,
  NeuraiChainType,
  NeuraiNetwork,
  WalletKind,
  chainFor,
  createDefaultBackend,
  isPQChain,
  type NeuraiBackend,
} from '../../blue_modules/neurai';
import { emitWalletChanged } from '../../blue_modules/neurai/eventBus';
import { AbstractWallet } from './abstract-wallet';
import { Transaction, Utxo } from './types';

type NeuraiEngine = Awaited<ReturnType<typeof NeuraiJsWallet.createInstance>>;

const ONE_FULL_COIN = 1e8;
const FEE_TARGET_BLOCKS = 6;
const HISTORY_DELTA_BATCH_SIZE = 250;
const HISTORY_ITEM_BATCH_SIZE = 100;
const TX_CACHE_BATCH_SIZE = 100;

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

type HistoryAsset = IHistoryItem['assets'][number];

const getHistoryItem = (deltas: IDelta[], baseCurrency: string): IHistoryItem => {
  if (deltas.length === 1) {
    const delta = deltas[0];
    return {
      isSent: delta.satoshis < 0,
      fee: 0,
      assets: [
        {
          assetName: delta.assetName,
          satoshis: delta.satoshis,
          value: delta.satoshis / ONE_FULL_COIN,
        },
      ],
      blockHeight: delta.height,
      transactionId: delta.txid,
    };
  }

  const balanceByAsset: Record<string, number> = {};
  for (const delta of deltas) {
    balanceByAsset[delta.assetName] = (balanceByAsset[delta.assetName] || 0) + delta.satoshis;
  }

  let isSent = false;
  let assets: HistoryAsset[] = Object.keys(balanceByAsset).map(assetName => {
    if (balanceByAsset[assetName] < 0) isSent = true;
    return {
      assetName,
      satoshis: balanceByAsset[assetName],
      value: balanceByAsset[assetName] / ONE_FULL_COIN,
    };
  });

  if (isSent && assets.some(asset => asset.assetName !== baseCurrency)) {
    assets = assets.filter(asset => asset.assetName !== baseCurrency || asset.value >= 5);
  }

  return {
    assets,
    blockHeight: deltas[0].height,
    transactionId: deltas[0].txid,
    isSent,
    fee: 0,
  };
};

const getHistoryYielding = async (deltas: IDelta[], baseCurrency: string): Promise<IHistoryItem[]> => {
  if (!deltas) {
    throw Error('Argument deltas is mandatory and cannot be nullish');
  }

  const deltasByTransactionId = new Map<string, IDelta[]>();
  for (let i = 0; i < deltas.length; i += HISTORY_DELTA_BATCH_SIZE) {
    for (const delta of deltas.slice(i, i + HISTORY_DELTA_BATCH_SIZE)) {
      const txDeltas = deltasByTransactionId.get(delta.txid) || [];
      txDeltas.push(delta);
      deltasByTransactionId.set(delta.txid, txDeltas);
    }
    if (i + HISTORY_DELTA_BATCH_SIZE < deltas.length) {
      await yieldToEventLoop();
    }
  }

  const groupedDeltas = Array.from(deltasByTransactionId.values());
  const history: IHistoryItem[] = [];
  for (let i = 0; i < groupedDeltas.length; i += HISTORY_ITEM_BATCH_SIZE) {
    history.push(...groupedDeltas.slice(i, i + HISTORY_ITEM_BATCH_SIZE).map(items => getHistoryItem(items, baseCurrency)));
    if (i + HISTORY_ITEM_BATCH_SIZE < groupedDeltas.length) {
      await yieldToEventLoop();
    }
  }

  history.sort((h1, h2) => {
    const value1 = `${h1.blockHeight}_${h1.transactionId}`;
    const value2 = `${h2.blockHeight}_${h2.transactionId}`;
    if (value1 > value2) return -1;
    if (value1 < value2) return 1;
    return 0;
  });

  return history;
};

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
  /** Highest chain tip height covered by the last successful transaction scan. Persisted. */
  _lastTxBlockHeight: number;
  /** Cached `IHistoryItem[]` for the wallet list view. Persisted to disk so
   * the UI can render history immediately on app launch, before the refresh
   * RPC round-trip completes. Replaced wholesale on each `fetchTransactions`. */
  protected _historyItems: IHistoryItem[];
  /** Cached lightweight transactions for `getTransactions()`. Persisted to
   * disk so the wallet shows its known history before the next RPC fetch.
   * Replaced wholesale on each `fetchTransactions`. */
  protected _txCache: Transaction[];
  /** Last `status` hash the server reported per subscribed address.
   * Persisted to disk so the next app launch can call `subscribe.bulk` and
   * skip the heavy refetch when nothing changed while the app was closed —
   * the server compares the cached value against its current state and only
   * pushes a synthetic address.changed for diffs. */
  protected _addressStatus: Record<string, string>;

  /** Lazy engine + backend; created on first use, cleared on network change. */
  private _engine: NeuraiEngine | null;
  private _backend: NeuraiBackend | null;
  /** Disposer for the backend's address.changed listener, if the active
   * backend supports push (only WssBackend does today). */
  private _unsubscribeBackendPush: (() => void) | null;
  /** Coalesce burst pushes so a block touching many outputs runs one refetch. */
  private _pushFetchInFlight: boolean;
  private _pushFetchPending: boolean;

  abstract get walletKind(): WalletKind;

  constructor() {
    super();
    this.network = chainFor(DEFAULT_NETWORK, 'legacy');
    this.passphrase = '';
    this.addressPosition = 0;
    this._lastTxBlockHeight = 0;
    this._historyItems = [];
    this._txCache = [];
    this._addressStatus = {};
    this._engine = null;
    this._backend = null;
    this._unsubscribeBackendPush = null;
    this._pushFetchInFlight = false;
    this._pushFetchPending = false;

    // Hide non-serializable runtime caches from JSON.stringify so they never
    // end up in persisted wallet JSON. `_historyItems` and `_txCache` are
    // intentionally left enumerable — they are plain JSON-serializable and
    // we want them on disk so the UI can render previous history instantly
    // on app launch, before the next refresh RPC completes.
    Object.defineProperty(this, '_engine', { writable: true, enumerable: false, value: null });
    Object.defineProperty(this, '_backend', { writable: true, enumerable: false, value: null });
    Object.defineProperty(this, '_unsubscribeBackendPush', { writable: true, enumerable: false, value: null });
    Object.defineProperty(this, '_pushFetchInFlight', { writable: true, enumerable: false, value: false });
    Object.defineProperty(this, '_pushFetchPending', { writable: true, enumerable: false, value: false });
  }

  // ---------- network / passphrase ------------------------------------------------

  setNetwork(network: NeuraiChainType): void {
    if (network === this.network) return;
    this._enforceChainKind(network);
    this.network = network;
    if (this._unsubscribeBackendPush) {
      this._unsubscribeBackendPush();
      this._unsubscribeBackendPush = null;
    }
    this._engine = null;
    this._backend = null;
    this.balance = 0;
    this.unconfirmed_balance = 0;
    this.addressPosition = 0;
    this._lastTxBlockHeight = 0;
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
    this._seedBackendStatuses();
    this._wireBackendPushHandler();
  }

  getBackend(): NeuraiBackend {
    if (!this._backend) {
      this._backend = createDefaultBackend(this.getNeuraiNetwork(), this.walletKind);
      this._seedBackendStatuses();
      this._wireBackendPushHandler();
    }
    return this._backend;
  }

  /**
   * Seed the WSS backend's per-address status cache from disk so the first
   * `subscribe.bulk` after app cold start can suppress refetches when
   * nothing changed while the app was closed. No-op for backends that don't
   * implement the push protocol (RPC, ElectrumX stub).
   */
  private _seedBackendStatuses(): void {
    if (!this._backend) return;
    const seed = (this._backend as { seedKnownStatuses?: (s: Record<string, string>) => void }).seedKnownStatuses;
    if (typeof seed === 'function' && this._addressStatus) {
      seed.call(this._backend, this._addressStatus);
    }
  }

  /**
   * Snapshot the backend's current per-address status cache back onto the
   * wallet for persistence. Called after the wallet has just re-fetched
   * (post-push or post-pull-to-refresh) so the next session can pick up
   * where this one left off. Best-effort — silently no-op for non-WSS
   * backends.
   */
  private _persistBackendStatuses(): void {
    if (!this._backend) return;
    const get = (this._backend as { getKnownStatuses?: () => Record<string, string> }).getKnownStatuses;
    if (typeof get !== 'function') return;
    const snapshot = get.call(this._backend);
    if (snapshot && typeof snapshot === 'object') this._addressStatus = snapshot;
  }

  /**
   * Lightweight "I am here" handshake for use on screen focus: connects to
   * the WSS backend (if not already) and subscribes the wallet's addresses
   * so the server starts pushing address.changed events. Does NOT trigger
   * any balance/history fetch on its own — the subscribe.bulk response is
   * compared against the persisted status cache by the backend, and a
   * synthetic address.changed event is fired only when something actually
   * changed.
   *
   * Critically, this does NOT bootstrap the engine if we already have a
   * persisted address set from a previous session: PQ engines do ML-DSA
   * key derivation that can stall the JS thread for 1–2s per wallet, so
   * making the home screen wait for that just to send a subscribe is a
   * non-starter. The engine bootstraps lazily on the first Send/Receive
   * action or the first push-triggered refetch.
   */
  async ensureBackendConnected(): Promise<void> {
    const backend = this.getBackend();
    // Skip entirely if the active backend has no push protocol (the
    // DisabledBackend mainnet stub, RpcBackend fallback, ElectrumX stub):
    // there's nothing to subscribe to, and creating the engine just to learn
    // there's nothing to do can cost 2+ seconds of blocked JS thread.
    const supportsPush = typeof (backend as { setSubscribedAddresses?: unknown }).setSubscribedAddresses === 'function';
    if (!supportsPush) return;

    const cachedAddresses = Object.keys(this._addressStatus || {});
    if (cachedAddresses.length > 0) {
      this._notifyBackendAddresses(backend, cachedAddresses);
      return;
    }
    // First-ever run for this wallet: pay the engine bootstrap cost here.
    const engine = await this.ensureEngine();
    this._notifyBackendAddresses(backend, engine.getAddresses());
  }

  /**
   * If the backend supports server-pushed address.changed events (WssBackend
   * does), register a handler that re-fetches the wallet whenever the server
   * tells us a subscribed address moved. Coalesces bursts so a block with
   * many touched outputs collapses into a single refetch.
   */
  private _wireBackendPushHandler(): void {
    if (!this._backend) return;
    if (this._unsubscribeBackendPush) {
      this._unsubscribeBackendPush();
      this._unsubscribeBackendPush = null;
    }
    const onAddressChanged = (this._backend as { onAddressChanged?: (cb: () => void) => () => void }).onAddressChanged;
    if (typeof onAddressChanged !== 'function') return;
    this._unsubscribeBackendPush = onAddressChanged.call(this._backend, () => {
      if (this._pushFetchInFlight) {
        this._pushFetchPending = true;
        return;
      }
      this._pushFetchInFlight = true;
      (async () => {
        try {
          do {
            this._pushFetchPending = false;
            await this.fetchBalance();
            await this.fetchTransactions();
            console.log('[NeuraiWallet] push refresh done, balance=', this.balance, 'txs=', this._txCache.length);
            // Notify the React state layer so `wallets`-consuming screens
            // (WalletsList, etc.) re-render. Internal wallet mutations are
            // invisible to React otherwise — useStorage hands out the same
            // array identity until something calls setWallets.
            emitWalletChanged(this.getID());
          } while (this._pushFetchPending);
        } catch (err) {
          console.warn('AbstractNeuraiWallet: push-triggered refetch failed', err);
        } finally {
          this._pushFetchInFlight = false;
        }
      })();
    });
  }

  // ---------- addresses ------------------------------------------------------------

  async getReceiveAddressAsync(): Promise<string> {
    // Fast path for PQ wallets: the receive address is the only address
    // (current PQ wallets always reuse). We have it in the persisted status
    // cache, so we can answer without paying the engine bootstrap cost
    // (~2s of ML-DSA key derivation) that would otherwise freeze the
    // ReceiveDetails screen.
    const cached = this._getCachedReceiveAddress();
    if (cached) return cached;
    const engine = await this.ensureEngine();
    return engine.getReceiveAddress();
  }

  async getStaticReceiveAddress(): Promise<string> {
    // Same fast path as getReceiveAddressAsync for PQ-with-reuse wallets:
    // the address is in our persisted cache, no need to bootstrap the
    // engine just to render a QR. The change-address side effect below
    // is irrelevant for PQ-with-reuse (change collapses on the receive
    // address by design); legacy HD wallets still go through the engine.
    const cached = this._getCachedReceiveAddress();
    if (cached) return cached;
    const engine = await this.ensureEngine();
    const addrs = engine.getAddresses();
    if (addrs.length === 0) throw new Error('Engine has no addresses');
    // Mark this address as the active receive so the engine excludes it when
    // picking a change address; otherwise getChangeAddress() can return the
    // same index and trip "Change address cannot be the same as to address".
    (engine as unknown as { receiveAddress: string }).receiveAddress = addrs[0];
    return addrs[0];
  }

  /** Returns the wallet's cached receive address if we can answer without
   * the engine. For PQ-with-reuse, the only address the wallet ever uses
   * is the key in `_addressStatus` (populated from the previous session's
   * subscribe.bulk). Returns null when the cache is empty or when the
   * wallet has multiple subscribed addresses (HD: different indices may
   * each be a valid receive). */
  private _getCachedReceiveAddress(): string | null {
    if (this.walletKind !== 'pq') return null;
    const keys = Object.keys(this._addressStatus || {});
    return keys.length === 1 ? keys[0] : null;
  }

  // The Bitcoin pipeline (ReceiveDetails, deeplink router, push-notifications)
  // calls `getAddress()` synchronously and `getAddressAsync()` for the slow
  // path. Wire both to the engine so freshly-created Neurai wallets show a QR
  // and copyable address as soon as they're prewarmed.
  getAddress(): string | false | undefined {
    if (this._engine) {
      try {
        const addrs = this._engine.getAddresses();
        return addrs[0] ?? false;
      } catch {
        return false;
      }
    }
    // Engine not bootstrapped yet: serve from the persisted address cache so
    // sync callers (ReceiveDetails QR, clipboard checks) don't return false
    // and trip a 2s engine bootstrap on every entry to the wallet screen.
    return this._getCachedReceiveAddress() ?? false;
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

  getAllExternalAddresses(): string[] {
    return this.getCachedAddresses();
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
    const utxos = await this.getBackend().getUtxos(engine.getAddresses());
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

  async shouldRefreshTransactionsForNewBlock(): Promise<boolean> {
    const tipHeight = await this.getBackend().getTipHeight();
    return this._lastTxBlockHeight <= 0 || tipHeight > this._lastTxBlockHeight;
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
    const backend = this.getBackend();
    this._notifyBackendAddresses(backend, addresses);
    const xnaBalance = await backend.getBalance(addresses);
    this.balance = Math.round(xnaBalance * ONE_FULL_COIN);
    this.unconfirmed_balance = 0;
    this._lastBalanceFetch = Date.now();
    this._persistBackendStatuses();
  }

  /** If the active backend supports server pushes, tell it which addresses
   * to subscribe to so address.changed events flow back here. Best-effort —
   * a missing or failing subscribe path must never break the fetch flow. */
  private _notifyBackendAddresses(backend: NeuraiBackend, addresses: string[]): void {
    const setSubscribed = (backend as { setSubscribedAddresses?: (addrs: string[]) => Promise<void> }).setSubscribedAddresses;
    if (typeof setSubscribed !== 'function') return;
    // PQ wallets currently always reuse the receive address (no change
    // address), so every state transition collapses on addresses[0] — no
    // need to subscribe to the rest of the derivation window. Legacy HD
    // wallets need every external/change address so a tx to any index
    // triggers a refresh.
    const target = this.walletKind === 'pq' && addresses.length > 0 ? [addresses[0]] : addresses;
    setSubscribed.call(backend, target).catch(err => {
      console.debug('AbstractNeuraiWallet: setSubscribedAddresses failed', err);
    });
  }

  async fetchTransactions(): Promise<void> {
    const engine = await this.ensureEngine();
    const addresses = engine.getAddresses();
    const backend = this.getBackend();
    this._notifyBackendAddresses(backend, addresses);
    const [rawDeltas, tipHeight] = await Promise.all([
      backend.getAddressHistory(addresses),
      backend.getTipHeight().catch(() => 0),
    ]);
    const deltas = rawDeltas as unknown as IDelta[];
    await yieldToEventLoop();
    const baseCurrency = engine.getBaseCurrency();
    const items = await getHistoryYielding(deltas, baseCurrency);
    await yieldToEventLoop();

    // Prefer per-delta block times (WSS backend embeds them in the history
    // payload); fall back to a `getBlockTimes` round-trip only for heights
    // not covered by the deltas, so the RPC backend keeps working.
    const blockTimes: Record<number, number> = {};
    for (const d of rawDeltas) {
      if (typeof d.time === 'number' && d.height > 0 && blockTimes[d.height] === undefined) {
        blockTimes[d.height] = d.time;
      }
    }
    const missingHeights = Array.from(
      new Set(items.map(i => i.blockHeight).filter(h => h > 0 && blockTimes[h] === undefined)),
    );
    if (missingHeights.length > 0) {
      try {
        const fetched = await backend.getBlockTimes(missingHeights);
        Object.assign(blockTimes, fetched);
      } catch (err) {
        console.debug('fetchTransactions: getBlockTimes failed', err);
      }
    }

    const txCache: Transaction[] = [];
    for (let i = 0; i < items.length; i += TX_CACHE_BATCH_SIZE) {
      txCache.push(...items.slice(i, i + TX_CACHE_BATCH_SIZE).map(item => this._historyItemToTransaction(item, deltas, blockTimes)));
      if (i + TX_CACHE_BATCH_SIZE < items.length) {
        await yieldToEventLoop();
      }
    }
    this._historyItems = items;
    this._txCache = txCache;
    this._lastTxFetch = Date.now();
    this._lastTxBlockHeight = Math.max(tipHeight, this._lastTxBlockHeight, ...items.map(item => item.blockHeight));
    this._persistBackendStatuses();
  }

  getTransactions(): Transaction[] {
    return this._txCache;
  }

  /** Raw history items as returned by `@neuraiproject/neurai-history-list`. */
  getHistoryItems(): IHistoryItem[] {
    return this._historyItems;
  }

  // ---------- transactions ---------------------------------------------------------

  async buildSendTransaction(
    targets: NeuraiTransactionTarget[],
    opts?: { forcedChangeAddress?: string },
  ): Promise<NeuraiBuildTransactionResult> {
    if (targets.length === 0) {
      throw new Error('buildSendTransaction requires at least one target');
    }
    const engine = await this.ensureEngine();
    const forcedChangeAddressBaseCurrency = opts?.forcedChangeAddress;

    if (targets.length === 1) {
      const result = await engine.createTransaction({
        toAddress: targets[0].address,
        amount: targets[0].amount,
        forcedChangeAddressBaseCurrency,
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
    const result = await engine.createSendManyTransaction({ outputs, forcedChangeAddressBaseCurrency });
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

  private _historyItemToTransaction(item: IHistoryItem, _deltas: IDelta[], blockTimes: Record<number, number>): Transaction {
    const xnaAsset = item.assets.find(a => a.assetName === 'XNA');
    const value = xnaAsset ? Math.round(xnaAsset.satoshis) : 0;
    // Mempool txs (height 0) get the current wall clock so the UI shows
    // "just now" instead of 1970. Confirmed txs use the block header time.
    const nowSec = Math.floor(Date.now() / 1000);
    const time = item.blockHeight > 0 ? (blockTimes[item.blockHeight] ?? nowSec) : nowSec;
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
