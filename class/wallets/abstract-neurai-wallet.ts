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

import { InteractionManager } from 'react-native';
import NeuraiJsWallet from '@neuraiproject/neurai-jswallet';
import NeuraiKey from '@neuraiproject/neurai-key';
import { type IDelta, type IHistoryItem } from '@neuraiproject/neurai-history-list';
import { createPaymentTransaction, createStandardAssetTransferTransaction } from '@neuraiproject/neurai-create-transaction';
import { sign as signNeuraiTransaction } from '@neuraiproject/neurai-sign-transaction';
import type { NeuraiESP32 } from '@neuraiproject/neurai-sign-esp32/react-native';
import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import {
  CHAIN_PARAMS,
  DEFAULT_NETWORK,
  NeuraiChainType,
  NeuraiNetwork,
  WalletKind,
  chainFor,
  createDefaultBackend,
  createDefaultRpcBackend,
  isPQChain,
  type NeuraiBackend,
} from '../../blue_modules/neurai';
import type { AddressChangedEvent } from '../../blue_modules/neurai/WssBackend';
import { emitWalletChanged } from '../../blue_modules/neurai/eventBus';
import { estimateNeuraiFeeSats } from '../../blue_modules/neurai/feeEstimate';
import { getAssetType, type NeuraiHeldAsset } from '../../blue_modules/neurai/assetUtils';
import { AbstractWallet } from './abstract-wallet';
import { Transaction, Utxo } from './types';

type NeuraiEngine = Awaited<ReturnType<typeof NeuraiJsWallet.createInstance>>;

const ONE_FULL_COIN = 1e8;
const FEE_TARGET_BLOCKS = 6;
/** A locally-tracked pending send times out after this long if it never
 * confirms (e.g. dropped or replaced in the mempool) so it stops subtracting
 * from the displayed balance forever. */
const PENDING_TX_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_DELTA_BATCH_SIZE = 250;
const HISTORY_ITEM_BATCH_SIZE = 100;
const TX_CACHE_BATCH_SIZE = 100;
/** Outputs below this many sats are dust; a sub-dust change is folded into the fee. */
const SEND_DUST_SATS = 546;

/** Minimal UTXO shape we need for selection / signing (matches engine `IUTXO`). */
interface SpendableUtxo {
  txid: string;
  outputIndex: number;
  satoshis: number;
  address: string;
  assetName: string;
  script: string;
}

/** Greedy UTXO selection: accumulate until `neededSats` is covered. Throws if the
 * pool can't cover it. */
function selectUtxosForSats<T extends { satoshis: number }>(utxos: T[], neededSats: number): T[] {
  const selected: T[] = [];
  let sum = 0;
  for (const u of utxos) {
    if (sum >= neededSats) break;
    selected.push(u);
    sum += u.satoshis;
  }
  if (sum < neededSats) throw new Error(`Insufficient funds — need ${neededSats} sats, have ${sum}`);
  return selected;
}

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Build a human-readable string from a backend/RPC error. `@neuraiproject/neurai-rpc`
 * rejects node errors as `{ status, statusText, description, error: { code, message } }`
 * with NO `.message` of its own, so a naive `err.message` is empty — which is exactly
 * why the WSS service collapses node rejections to a useless "broadcast failed". Pull
 * the real reason out of `error` / `description` here.
 */
function describeBackendError(e: unknown): string {
  if (e == null) return 'unknown error';
  const o = e as Record<string, unknown>;
  const parts: string[] = [];
  if (o.description) parts.push(`description=${String(o.description)}`);
  if (o.error) parts.push(`error=${typeof o.error === 'string' ? o.error : JSON.stringify(o.error)}`);
  if (o.status != null) parts.push(`status=${String(o.status)}`);
  if (o.statusText) parts.push(`statusText=${String(o.statusText)}`);
  if (o.message) parts.push(`message=${String(o.message)}`);
  if (o.code != null) parts.push(`code=${String(o.code)}`);
  if (o.type) parts.push(`type=${String(o.type)}`);
  if (parts.length === 0) {
    try {
      return JSON.stringify(o);
    } catch {
      return String(o);
    }
  }
  return parts.join(' | ');
}

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
  /** Amount sent to the recipient, in satoshis (for display). */
  sentAmountSats: number;
  /** Net amount leaving the wallet, in satoshis (amount sent + fee). For an
   * asset transfer this is just the XNA fee (the recipient asset output carries
   * ~0 XNA). */
  netDebitSats: number;
  /** Present only for asset transfers: the asset name and amount (full units)
   * being sent. Absent for plain XNA sends. */
  asset?: { name: string; amount: number };
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
  /** Cached list of assets (tokens) this wallet holds. Persisted to disk
   * (enumerable) like `_historyItems` so the wallet card on the home screen and
   * the in-wallet Assets tab can render a count/list immediately on app launch,
   * before the next refresh. Refreshed at the end of `fetchTransactions`. */
  protected _heldAssets: NeuraiHeldAsset[];
  /** Just-broadcast outgoing sends, shown optimistically as 0-conf "pending"
   * entries and subtracted from the balance until the backend surfaces them
   * confirmed. Persisted (enumerable) like `_txCache` so a pending send
   * survives an app restart; reconciled away in `fetchTransactions` once the
   * real tx confirms, or after {@link PENDING_TX_TTL_MS}. */
  protected _pendingTxs: Transaction[];
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
    this._heldAssets = [];
    this._pendingTxs = [];
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
    this._heldAssets = [];
    this._pendingTxs = [];
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
    const onAddressChanged = (this._backend as { onAddressChanged?: (cb: (event: AddressChangedEvent) => void) => () => void })
      .onAddressChanged;
    if (typeof onAddressChanged !== 'function') return;
    this._unsubscribeBackendPush = onAddressChanged.call(this._backend, (event: AddressChangedEvent) => {
      // Apply whatever the server gave us synchronously and cheaply: balance
      // is in the payload for PQ-with-reuse (single subscribed address ==
      // wallet total). Doing this before yielding means the UI shows fresh
      // numbers immediately, even if the historical refetch is deferred or
      // never runs (e.g. when no new txids landed).
      this._applyPushEvent(event);

      // Decide whether a history refetch is actually needed. Pure status
      // bumps (confirmed_txids / removed_txids / touched_assets only) don't
      // add anything to the tx list — the existing entries already cover
      // those txids. Only new txids force a re-pull.
      const delta = event.delta;
      const hasNewTxids = !!delta?.added_txids && delta.added_txids.length > 0;
      const noDeltaInfo = !delta;
      if (!hasNewTxids && !noDeltaInfo) {
        // Balance was already applied above and nothing else needs fetching.
        emitWalletChanged(this.getID());
        return;
      }

      if (this._pushFetchInFlight) {
        this._pushFetchPending = true;
        return;
      }
      this._pushFetchInFlight = true;
      // Defer the heavy refetch until any current UI interaction (screen
      // transitions, taps, FlatList batches) settles. Without this the
      // synchronous tx-parse chunks compete with the user's first tap on
      // Send/Receive and the JS thread block makes the buttons feel dead.
      InteractionManager.runAfterInteractions(async () => {
        try {
          do {
            this._pushFetchPending = false;
            // Skip fetchBalance: `_applyPushEvent` above already updated
            // `this.balance` from the server's pushed payload for the wallet
            // kinds where that's safe; for HD wallets we still need the
            // multi-address sum, so we keep fetching there.
            if (this.walletKind !== 'pq') {
              await this.fetchBalance();
            }
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
      });
    });
  }

  /**
   * Apply the cheap, server-pushed fields from an `address.changed` event
   * directly to wallet state — no network round-trip, no engine touch. Only
   * the bits we can trust without re-summing across addresses are taken:
   *  - `balance`: safe only when one address represents the whole wallet
   *    (PQ-with-reuse). For HD we'd need to sum across the subscription set,
   *    so the deferred `fetchBalance` still owns that case.
   * Returning quickly lets the UI render the new number before the deferred
   * `fetchTransactions` runs (or in cases where no fetch is needed at all).
   */
  private _applyPushEvent(event: AddressChangedEvent): void {
    if (this.walletKind === 'pq' && event.balance && typeof event.balance.confirmed === 'number') {
      // The push payload's `confirmed` is already in satoshis (1e8 / coin).
      this.balance = event.balance.confirmed;
      this.unconfirmed_balance = typeof event.balance.unconfirmed === 'number' ? event.balance.unconfirmed : 0;
      this._lastBalanceFetch = Date.now();
    }
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
   * The set of addresses this wallet watches for balance/history/UTXO. Default
   * is the engine's derived address window. Subclasses that have no engine
   * (e.g. an external-signing hardware wallet that only knows its own address)
   * override this to provide their address(es) without bootstrapping an engine.
   */
  protected async _walletAddresses(): Promise<string[]> {
    const engine = await this.ensureEngine();
    return engine.getAddresses();
  }

  /** Base currency code used to interpret history deltas. Defaults to the
   * engine's; engine-less subclasses override it. */
  protected async _walletBaseCurrency(): Promise<string> {
    const engine = await this.ensureEngine();
    return engine.getBaseCurrency();
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
    const utxos = await this.getBackend().getUtxos(await this._walletAddresses());
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
    const addresses = await this._walletAddresses();
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
    const addresses = await this._walletAddresses();
    const backend = this.getBackend();
    this._notifyBackendAddresses(backend, addresses);
    const [rawDeltas, tipHeight] = await Promise.all([backend.getAddressHistory(addresses), backend.getTipHeight().catch(() => 0)]);
    const deltas = rawDeltas as unknown as IDelta[];
    await yieldToEventLoop();
    const baseCurrency = await this._walletBaseCurrency();
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
    const missingHeights = Array.from(new Set(items.map(i => i.blockHeight).filter(h => h > 0 && blockTimes[h] === undefined)));
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
      txCache.push(
        ...items.slice(i, i + TX_CACHE_BATCH_SIZE).map(item => this._historyItemToTransaction(item, deltas, blockTimes, tipHeight)),
      );
      if (i + TX_CACHE_BATCH_SIZE < items.length) {
        await yieldToEventLoop();
      }
    }
    this._historyItems = items;
    this._txCache = txCache;
    // Reconcile optimistic pending sends against the fresh history: drop any
    // that have now confirmed (or aged out).
    this._prunePendingTxs();
    this._lastTxFetch = Date.now();
    this._lastTxBlockHeight = Math.max(tipHeight, this._lastTxBlockHeight, ...items.map(item => item.blockHeight));
    this._persistBackendStatuses();
    // Refresh the held-asset cache off the critical path: the engine is already
    // bootstrapped here (via `_walletAddresses`), so this is just one extra RPC.
    // Fire-and-forget so it never delays the transaction render; it emits its
    // own `walletChanged` when the list arrives.
    this.refreshHeldAssets().catch(err => console.debug('AbstractNeuraiWallet: refreshHeldAssets failed', err));
  }

  // ---------- assets ---------------------------------------------------------------

  /** Held assets (tokens) from the last refresh. Synchronous — reads the
   * persisted cache, so the home-screen card and the Assets tab can render
   * without bootstrapping the engine. */
  getHeldAssetsCached(): NeuraiHeldAsset[] {
    return this._heldAssets;
  }

  /**
   * Fetch the wallet's current asset balances via the engine and refresh the
   * cache. The engine's `getAssets()` returns base-currency (XNA) and
   * zero-balance rows too (its internal filter is a no-op), so we drop those
   * here. Amounts come back already divided by 1e8 in `value`.
   */
  async refreshHeldAssets(): Promise<void> {
    const engine = await this.ensureEngine();
    const baseCurrency = await this._walletBaseCurrency();
    const raw = (await engine.getAssets()) as Array<{ assetName?: string; balance?: number; value?: number }> | null;
    const assets: NeuraiHeldAsset[] = (raw ?? [])
      .filter(a => typeof a?.assetName === 'string' && a.assetName !== baseCurrency && (a.balance ?? 0) > 0)
      .map(a => ({
        name: a.assetName as string,
        type: getAssetType(a.assetName as string),
        amount: typeof a.value === 'number' ? a.value : (a.balance as number) / ONE_FULL_COIN,
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
    this._heldAssets = assets;
    emitWalletChanged(this.getID());
  }

  getTransactions(): Transaction[] {
    this._prunePendingTxs();
    if (this._pendingTxs.length === 0) return this._txCache;
    // Hide a pending entry once the backend surfaces the same txid (0-conf or
    // confirmed) so the list never shows a duplicate row for one transaction.
    const cached = new Set(this._txCache.map(t => t.txid));
    const stillPending = this._pendingTxs.filter(t => !cached.has(t.txid));
    if (stillPending.length === 0) return this._txCache;
    return [...stillPending, ...this._txCache];
  }

  getUnconfirmedBalance(): number {
    this._prunePendingTxs();
    // Pending sends keep subtracting from the balance until they CONFIRM: the
    // backend's confirmed balance does not drop until the tx is mined, so the
    // deduction must persist through the mempool / 0-conf window.
    const pendingDelta = this._pendingTxs.filter(t => !this._isConfirmedInCache(t.txid)).reduce((sum, t) => sum + (t.value ?? 0), 0);
    if (pendingDelta < 0) {
      // Take the most-negative of the local delta and any server-reported
      // unconfirmed value so the same spend is never counted twice (the PQ
      // push path may already reflect it in `unconfirmed_balance`).
      return Math.min(this.unconfirmed_balance, pendingDelta);
    }
    return this.unconfirmed_balance;
  }

  /**
   * Record a just-broadcast outgoing transaction so it shows immediately as a
   * 0-conf "pending" entry and its value is subtracted from the balance,
   * without waiting for the backend to index the mempool. Reconciled away in
   * `fetchTransactions` once the real tx confirms (or after a TTL).
   * @param txid       broadcast transaction id
   * @param valueSats  net wallet debit in sats; negative (amount sent + fee)
   * @param asset      for an asset transfer, the token name and amount sent
   *                   (positive full units) so the pending row shows the asset.
   */
  addPendingTx(txid: string, valueSats: number, asset?: { name: string; amount: number }): void {
    if (!txid || this._pendingTxs.some(t => t.txid === txid)) return;
    const nowSec = Math.floor(Date.now() / 1000);
    this._pendingTxs.unshift({
      txid,
      hash: txid,
      version: 0,
      size: 0,
      vsize: 0,
      weight: 0,
      locktime: 0,
      inputs: [],
      outputs: [],
      blockhash: '',
      confirmations: 0,
      time: nowSec,
      blocktime: nowSec,
      timestamp: nowSec,
      value: valueSats,
      assetName: asset?.name,
      // Pending entries are always outgoing sends → negative asset amount.
      assetAmount: asset ? -Math.abs(asset.amount) : undefined,
    });
    emitWalletChanged(this.getID());
  }

  private _isConfirmedInCache(txid: string): boolean {
    return this._txCache.some(t => t.txid === txid && t.confirmations > 0);
  }

  /** Drop pending entries that have CONFIRMED in the cache or aged out (TTL). */
  private _prunePendingTxs(): void {
    if (this._pendingTxs.length === 0) return;
    const cutoffSec = Math.floor((Date.now() - PENDING_TX_TTL_MS) / 1000);
    this._pendingTxs = this._pendingTxs.filter(t => !this._isConfirmedInCache(t.txid) && t.timestamp >= cutoffSec);
  }

  /** Raw history items as returned by `@neuraiproject/neurai-history-list`. */
  getHistoryItems(): IHistoryItem[] {
    return this._historyItems;
  }

  // ---------- transactions ---------------------------------------------------------

  async buildSendTransaction(
    targets: NeuraiTransactionTarget[],
    opts?: { forcedChangeAddress?: string; assetName?: string },
  ): Promise<NeuraiBuildTransactionResult> {
    if (targets.length === 0) {
      throw new Error('buildSendTransaction requires at least one target');
    }
    const forcedChangeAddressBaseCurrency = opts?.forcedChangeAddress;
    const assetName = opts?.assetName;
    const isAsset = !!assetName && assetName !== 'XNA';

    // Asset transfers go through `engine.transferAsset` (neurai-assets 1.3.3):
    // it supports multiple recipients and every asset type, and crucially does
    // the owner-token dance required to move soulbound DePIN / restricted assets
    // — which the plain engine send path does not. The legacy manual builder is
    // kept as a single-recipient fallback in case the engine path is
    // unavailable or fails.
    if (isAsset) {
      const name = assetName as string;
      try {
        return await this._buildAssetTransferViaEngine(targets, name, forcedChangeAddressBaseCurrency);
      } catch (err) {
        console.warn('[Neurai] engine.transferAsset failed, falling back to manual asset builder:', describeBackendError(err));
        if (targets.length !== 1) throw err;
        return this._buildAssetTransferTransaction(targets[0].address, targets[0].amount, name, forcedChangeAddressBaseCurrency);
      }
    }

    const engine = await this.ensureEngine();
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
        sentAmountSats: Math.round(result.debug.amount * ONE_FULL_COIN),
        netDebitSats: Math.round(result.debug.xnaAmount * ONE_FULL_COIN),
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
      sentAmountSats: Math.round(result.debug.amount * ONE_FULL_COIN),
      netDebitSats: Math.round(result.debug.xnaAmount * ONE_FULL_COIN),
      debug: result.debug,
    };
  }

  /**
   * Build + sign an asset transfer via `engine.transferAsset` (neurai-assets
   * 1.3.3). Handles multiple recipients, every asset type, and the owner-token
   * spend/return needed to move soulbound DePIN / restricted assets. We pass
   * `broadcast: false` and let the caller broadcast through {@link broadcastTx}
   * so the descriptive WSS→RPC error fallback still applies. `amount` is in the
   * asset's display units (the node scales by the asset's declared decimals).
   */
  private async _buildAssetTransferViaEngine(
    targets: NeuraiTransactionTarget[],
    assetName: string,
    forcedChangeAddress?: string,
  ): Promise<NeuraiBuildTransactionResult> {
    const engine = await this.ensureEngine();
    const recipients = targets.map(t => ({ address: t.address, amount: t.amount }));
    const result = await engine.transferAsset({
      assetName,
      recipients,
      broadcast: false,
      ...(forcedChangeAddress ? { changeAddress: forcedChangeAddress } : {}),
    });
    const signedHex = result.signedTransaction ?? '';
    if (!signedHex) throw new Error('engine.transferAsset returned no signed transaction');
    const feeSats = Math.round((result.fee ?? 0) * ONE_FULL_COIN);
    const totalAmount = targets.reduce((sum, t) => sum + t.amount, 0);
    return {
      signedHex,
      unsignedHex: result.rawTx ?? '',
      fee: result.fee ?? 0,
      // An asset transfer sends ~0 XNA to the recipient; only the fee leaves the wallet.
      sentAmountSats: 0,
      netDebitSats: feeSats,
      asset: { name: assetName, amount: totalAmount },
      debug: result,
    };
  }

  /**
   * Build + sign an asset transfer transaction, mirroring the reference web
   * wallet (`neurai-addon-sign`) and our own `buildSendMaxTransaction`:
   *   - select asset UTXOs to cover the amount (asset change back to the wallet),
   *   - select XNA UTXOs to cover a fee priced off the backend rate (≥ min relay),
   *   - emit recipient/asset-change `transfers` + an XNA-change `payment`,
   *   - assemble with `createStandardAssetTransferTransaction` and sign locally.
   * `amount` is in full asset units; asset amounts use the same 1e8 raw scaling
   * as XNA satoshis.
   */
  private async _buildAssetTransferTransaction(
    toAddress: string,
    amount: number,
    assetName: string,
    forcedChangeAddress?: string,
  ): Promise<NeuraiBuildTransactionResult> {
    const engine = await this.ensureEngine();
    // Asset UTXOs and native (XNA) UTXOs come from different RPC queries:
    // `getUTXOs()` is `getaddressutxos` with NO assetName (native only), while
    // `getAssetUTXOs(name)` passes the assetName. Filtering `getUTXOs()` by an
    // asset name therefore always yields nothing — fetch each from its source.
    const [assetUtxosRaw, xnaUtxosRaw, mempool] = await Promise.all([
      engine.getAssetUTXOs(assetName),
      engine.getUTXOs(),
      engine.getMempool().catch(() => []),
    ]);
    const spentInMempool = new Set(mempool.map(m => `${m.prevtxid}:${m.prevout}`));
    const spendable = (u: SpendableUtxo) => u.satoshis > 0 && !spentInMempool.has(`${u.txid}:${u.outputIndex}`);
    const assetUtxos = (assetUtxosRaw as unknown as SpendableUtxo[]).filter(u => u.assetName === assetName && spendable(u));
    const xnaUtxos = (xnaUtxosRaw as unknown as SpendableUtxo[]).filter(u => (u.assetName === 'XNA' || !u.assetName) && spendable(u));
    if (assetUtxos.length === 0) throw new Error(`No spendable ${assetName} to send`);
    if (xnaUtxos.length === 0) throw new Error('No spendable XNA to cover the network fee');

    const amountRaw = Math.round(amount * ONE_FULL_COIN);
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) throw new Error('Invalid asset amount');
    const totalAssetRaw = assetUtxos.reduce((sum, u) => sum + u.satoshis, 0);
    if (totalAssetRaw < amountRaw) throw new Error(`Insufficient ${assetName} balance`);

    const selectedAsset = selectUtxosForSats(assetUtxos, amountRaw);
    const assetChangeRaw = selectedAsset.reduce((sum, u) => sum + u.satoshis, 0) - amountRaw;

    const feeRate = await this.estimateFeeRate();
    const xnaChangeAddress = forcedChangeAddress ?? (await engine.getChangeAddress());
    const assetChangeAddress = forcedChangeAddress ?? (await engine.getAssetChangeAddress());

    // Two-pass fee: estimate with one XNA input, select to cover it, then
    // re-estimate with the chosen input count (and the change outputs present).
    const outputAddresses = (xnaChange: boolean) => [
      toAddress,
      ...(assetChangeRaw > 0 ? [assetChangeAddress] : []),
      ...(xnaChange ? [xnaChangeAddress] : []),
    ];
    let selectedXna = [xnaUtxos[0]];
    let feeSats = estimateNeuraiFeeSats(
      [...selectedAsset, ...selectedXna].map(u => u.script),
      outputAddresses(true),
      feeRate,
    );
    selectedXna = selectUtxosForSats(xnaUtxos, feeSats + SEND_DUST_SATS);
    feeSats = estimateNeuraiFeeSats(
      [...selectedAsset, ...selectedXna].map(u => u.script),
      outputAddresses(true),
      feeRate,
    );

    const xnaIn = selectedXna.reduce((sum, u) => sum + u.satoshis, 0);
    let xnaChangeSats = xnaIn - feeSats;
    if (xnaChangeSats < 0) throw new Error('Balance too low to cover the network fee');
    // Fold a sub-dust change into the fee rather than emitting an unspendable output.
    if (xnaChangeSats > 0 && xnaChangeSats < SEND_DUST_SATS) {
      feeSats += xnaChangeSats;
      xnaChangeSats = 0;
    }

    const transfers: { address: string; assetName: string; amountRaw: bigint }[] = [
      { address: toAddress, assetName, amountRaw: BigInt(amountRaw) },
    ];
    if (assetChangeRaw > 0) transfers.push({ address: assetChangeAddress, assetName, amountRaw: BigInt(assetChangeRaw) });
    const payments: { address: string; valueSats: bigint }[] = [];
    if (xnaChangeSats > 0) payments.push({ address: xnaChangeAddress, valueSats: BigInt(xnaChangeSats) });

    const inputs = [...selectedAsset, ...selectedXna];
    const built = createStandardAssetTransferTransaction({
      inputs: inputs.map(u => ({ txid: u.txid, vout: u.outputIndex })),
      payments,
      transfers,
    });

    const privateKeys: Record<string, unknown> = {};
    for (const u of inputs) {
      const material = engine.getPrivateKeyByAddress(u.address);
      if (material) privateKeys[u.address] = material;
    }
    const signedHex = signNeuraiTransaction(
      this.network as Parameters<typeof signNeuraiTransaction>[0],
      built.rawTx,
      inputs as unknown as Parameters<typeof signNeuraiTransaction>[2],
      privateKeys as Parameters<typeof signNeuraiTransaction>[3],
    );
    if (!signedHex) throw new Error('Failed to sign the asset transfer');

    return {
      signedHex,
      unsignedHex: built.rawTx,
      fee: feeSats / ONE_FULL_COIN,
      // An asset transfer sends 0 XNA to the recipient; only the fee leaves the wallet.
      sentAmountSats: 0,
      netDebitSats: feeSats,
      asset: { name: assetName, amount },
      debug: { assetName, amountRaw, assetChangeRaw, feeSats, xnaChangeSats, inputs: inputs.length },
    };
  }

  /**
   * Build a signed "send everything" transaction: spend ALL spendable XNA UTXOs
   * into a single output to `toAddress`, with the fee deducted from the amount
   * so the recipient receives `totalInputs − fee` and there is no change.
   *
   * The engine's `createTransaction` cannot express this: it always appends a
   * change output (a zero-value one would be rejected by the node) and its
   * greedy coin selection is amount-driven, so it would not reliably pull in
   * every UTXO. We therefore assemble the raw tx with `createPaymentTransaction`
   * (which emits exactly the outputs given) and sign it with the engine's own
   * key material via `neurai-sign-transaction`. The fee mirrors the engine's
   * size math (see {@link estimateNeuraiFeeSats}) so the node accepts it.
   */
  async buildSendMaxTransaction(toAddress: string): Promise<NeuraiBuildTransactionResult> {
    const engine = await this.ensureEngine();
    const [allUtxos, mempool] = await Promise.all([engine.getUTXOs(), engine.getMempool().catch(() => [])]);
    // Mirror the engine's `loadSpendableFunds`: drop UTXOs already being spent
    // by a mempool tx so a send-max issued right after another send can't
    // double-spend them.
    const spentInMempool = new Set(mempool.map(m => `${m.prevtxid}:${m.prevout}`));
    const utxos = allUtxos.filter(u => u.assetName === 'XNA' && u.satoshis > 0 && !spentInMempool.has(`${u.txid}:${u.outputIndex}`));
    if (utxos.length === 0) throw new Error('No spendable XNA funds to send');
    const totalIn = utxos.reduce((sum, u) => sum + u.satoshis, 0);

    const feeRateXnaPerKb = await this.estimateFeeRate();
    const feeSats = estimateNeuraiFeeSats(
      utxos.map(u => u.script),
      [toAddress],
      feeRateXnaPerKb,
    );
    const recipientSats = totalIn - feeSats;
    if (recipientSats <= 0) throw new Error('Balance too low to cover the network fee');

    const { rawTx } = createPaymentTransaction({
      inputs: utxos.map(u => ({ txid: u.txid, vout: u.outputIndex })),
      payments: [{ address: toAddress, valueSats: BigInt(recipientSats) }],
    });

    const privateKeys: Record<string, unknown> = {};
    for (const u of utxos) {
      const material = engine.getPrivateKeyByAddress(u.address);
      if (material) privateKeys[u.address] = material;
    }

    const signedHex = signNeuraiTransaction(
      this.network as Parameters<typeof signNeuraiTransaction>[0],
      rawTx,
      utxos as unknown as Parameters<typeof signNeuraiTransaction>[2],
      privateKeys as Parameters<typeof signNeuraiTransaction>[3],
    );
    if (!signedHex) throw new Error('Failed to sign the send-all transaction');

    return {
      signedHex,
      unsignedHex: rawTx,
      fee: feeSats / ONE_FULL_COIN,
      sentAmountSats: recipientSats,
      // Everything leaves the wallet: recipient gets totalIn − fee, the fee is
      // paid, no change returns — so the net debit is the whole balance.
      netDebitSats: totalIn,
      debug: { sendMax: true, totalIn, feeSats, recipientSats },
    };
  }

  /**
   * Build + sign a "reveal public key" transaction for the dedicated DePIN chat
   * address (account 100, `m/44'/coin'/100'/0/0`). That address lives OUTSIDE
   * the wallet's normal derivation window, so the engine doesn't hold its key —
   * we sign with the DePIN identity's WIF directly (`privateKeys[depinAddress]`).
   *
   * Spending any UTXO from the address publishes its public key on-chain, which
   * is required for others to encrypt DePIN group messages to it. We send a
   * small amount to `burnAddress` and return the rest as change to the DePIN
   * address. `utxos` are the address's base-currency UTXOs (fetched by the
   * caller from the DePIN node); broadcasting is also left to the caller.
   *
   * Mirrors {@link buildSendMaxTransaction} (manual assembly + backend-priced
   * fee) rather than `engine.createTransaction`, which can't sign for a foreign
   * address without per-UTXO key material.
   */
  async buildDepinPubkeyRevealTransaction(opts: {
    depinAddress: string;
    depinWif: string;
    utxos: SpendableUtxo[];
    burnAddress: string;
    amountSats: number;
    /** Hardware wallet: sign each input's sighash on the device (no local WIF). */
    device?: NeuraiESP32 | null;
  }): Promise<{ signedHex: string; feeSats: number; changeSats: number }> {
    const { depinAddress, depinWif, burnAddress, amountSats, device } = opts;
    const utxos = opts.utxos.filter(u => (u.assetName === 'XNA' || !u.assetName) && u.satoshis > 0 && u.address === depinAddress);
    if (utxos.length === 0) throw new Error('No spendable XNA at the DePIN address');
    const totalIn = utxos.reduce((sum, u) => sum + u.satoshis, 0);

    const feeRateXnaPerKb = await this.estimateFeeRate();
    let feeSats = estimateNeuraiFeeSats(
      utxos.map(u => u.script),
      [burnAddress, depinAddress],
      feeRateXnaPerKb,
    );
    let changeSats = totalIn - amountSats - feeSats;
    if (changeSats < 0) throw new Error('Insufficient funds at the DePIN address to cover the burn and fee');
    // Fold a sub-dust change into the fee rather than emitting an unspendable output.
    if (changeSats > 0 && changeSats < SEND_DUST_SATS) {
      feeSats += changeSats;
      changeSats = 0;
    }

    const payments: { address: string; valueSats: bigint }[] = [{ address: burnAddress, valueSats: BigInt(amountSats) }];
    if (changeSats > 0) payments.push({ address: depinAddress, valueSats: BigInt(changeSats) });

    const { rawTx } = createPaymentTransaction({
      inputs: utxos.map(u => ({ txid: u.txid, vout: u.outputIndex })),
      payments,
    });

    let signedHex: string;
    if (!depinWif && device) {
      // Hardware wallet: the DePIN key never leaves the device. Sign each legacy
      // P2PKH sighash on-device (same `hashForSignature` primitive the signing
      // library uses) and assemble the scriptSig from the DER sig + pubkey.
      signedHex = await this.signDepinRevealWithDevice(rawTx, utxos, device);
    } else {
      // The DePIN address is foreign to the engine, so supply its WIF directly.
      const privateKeys: Record<string, unknown> = { [depinAddress]: depinWif };
      signedHex = signNeuraiTransaction(
        this.network as Parameters<typeof signNeuraiTransaction>[0],
        rawTx,
        utxos as unknown as Parameters<typeof signNeuraiTransaction>[2],
        privateKeys as Parameters<typeof signNeuraiTransaction>[3],
      );
    }
    if (!signedHex) throw new Error('Failed to sign the DePIN reveal transaction');

    return { signedHex, feeSats, changeSats };
  }

  /**
   * Sign a legacy P2PKH DePIN-reveal transaction by routing each input's sighash
   * to the device (which holds the account-100' key). Assembles the standard
   * `<sig|SIGHASH_ALL> <pubkey>` scriptSig. The device confirms each signature
   * physically. All inputs belong to the single DePIN address, so one pubkey
   * signs them all.
   */
  private async signDepinRevealWithDevice(
    rawTx: string,
    utxos: SpendableUtxo[],
    device: NeuraiESP32,
  ): Promise<string> {
    const tx = bitcoin.Transaction.fromHex(rawTx);
    const byOutpoint = new Map(utxos.map(u => [`${u.txid}:${u.outputIndex}`, u]));
    const SIGHASH_ALL = bitcoin.Transaction.SIGHASH_ALL;

    for (let i = 0; i < tx.ins.length; i++) {
      const input = tx.ins[i];
      // `input.hash` is the txid in internal (reversed) byte order.
      const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
      const u = byOutpoint.get(`${prevTxid}:${input.index}`);
      if (!u) throw new Error('DePIN reveal: could not map an input to a DePIN UTXO');

      const prevScript = Buffer.from(u.script, 'hex');
      const sighash = tx.hashForSignature(i, prevScript, SIGHASH_ALL);
      const { signature, pubkey } = await device.depinSignDigest(Buffer.from(sighash).toString('hex'));

      const sigWithType = Buffer.concat([Buffer.from(signature, 'hex'), Buffer.from([SIGHASH_ALL])]);
      const scriptSig = bitcoin.script.compile([sigWithType, Buffer.from(pubkey, 'hex')]);
      tx.setInputScript(i, scriptSig);
    }

    return tx.toHex();
  }

  async broadcastTx(rawHex: string): Promise<string> {
    const primary = this.getBackend();
    try {
      return await primary.broadcast(rawHex);
    } catch (err) {
      console.warn(`[Neurai] primary broadcast failed (kind=${primary.kind}):`, describeBackendError(err));
      // The WSS service surfaces only a generic "broadcast failed" (code 1005)
      // and discards the node's real reason. Fall back to a direct node RPC,
      // which returns the descriptive reject reason (and relays the tx if the
      // failure was WSS-specific rather than a true node rejection).
      if (primary.kind === 'rpc') throw new Error(describeBackendError(err));
      let rpc: NeuraiBackend;
      try {
        rpc = createDefaultRpcBackend(this.getNeuraiNetwork(), this.walletKind);
      } catch (mkErr) {
        console.warn('[Neurai] could not create RPC fallback backend:', String(mkErr));
        throw new Error(describeBackendError(err));
      }
      try {
        const txid = await rpc.broadcast(rawHex);
        console.warn('[Neurai] RPC fallback broadcast OK:', txid);
        return txid;
      } catch (rpcErr) {
        const reason = describeBackendError(rpcErr);
        console.warn('[Neurai] RPC fallback broadcast failed:', reason);
        // Surface the node's descriptive reason instead of WSS's "broadcast failed".
        throw new Error(reason);
      }
    }
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
    tipHeight: number,
  ): Transaction {
    const xnaAsset = item.assets.find(a => a.assetName === 'XNA');
    const value = xnaAsset ? Math.round(xnaAsset.satoshis) : 0;
    // Real confirmation depth = tip − block + 1 (a tx in the tip block has 1).
    // Falls back to 1 when the tip is unknown (getTipHeight failed → 0) or the
    // cached tip lags behind the tx's block.
    const confirmations = item.blockHeight > 0 ? Math.max(1, tipHeight - item.blockHeight + 1) : 0;
    // A transaction that moves a Neurai asset (token) carries a non-XNA entry;
    // surface its name and signed amount so the list can render it as an asset
    // movement (e.g. "Sent · 100 FOO") rather than a plain XNA row.
    const nonXnaAsset = item.assets.find(a => a.assetName !== 'XNA');
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
      confirmations,
      time,
      blocktime: time,
      timestamp: time,
      value: item.isSent ? -Math.abs(value) : Math.abs(value),
      assetName: nonXnaAsset?.assetName,
      assetAmount: nonXnaAsset?.value,
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
