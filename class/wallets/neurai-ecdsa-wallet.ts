/**
 * HD Neurai wallet with strict ECDSA witness v3 addresses.
 *
 * Networks: `xna-ecdsa` (mainnet) and `xna-ecdsa-test` (testnet). Addresses
 * are Bech32m witness v3, `nq1r…` on mainnet and `tnq1r…` on testnet, the
 * node's `getnewaddress "" ecdsa` type. The key is an ordinary compressed
 * secp256k1 key, like Legacy, under its own branch `m/84'/coin'/0'/{0,1}/i`
 * (coin type 1900 / 1), so the same words give different addresses than a
 * Legacy wallet. Spends are smaller than Legacy ones (about 70 vbytes per
 * input), and the node only accepts them where witness v3 is active: testnet
 * for now.
 */

import { Buffer } from 'buffer';
import { encodeDestinationScript } from '@neuraiproject/neurai-create-transaction';
import {
  checkCode,
  decodeIndexMessage,
  deriveKeysFromMnemonic,
  parseIndexResponse,
  paymentPrivateKeyWIF,
  scanTweaks,
  type SilentPaymentKeys,
} from '@neuraiproject/neurai-silent-payments';
import { chainFor, isKindAvailable, NeuraiChainType, NeuraiNetwork, WalletKind } from '../../blue_modules/neurai';
import { amountFromInput, xnaToSats } from '../../blue_modules/neurai/amounts';
import { dustThresholdSats } from '../../blue_modules/neurai/dust';
import { estimateNeuraiFeeSats } from '../../blue_modules/neurai/feeEstimate';
import { looksLikeSilentPaymentCode, silentPaymentNetworkFor } from '../../blue_modules/neurai/silentPayments';
import {
  AbstractNeuraiWallet,
  type NeuraiBuildTransactionResult,
  type SilentPaymentOutput,
  type SpendableUtxo,
} from './abstract-neurai-wallet';

type SilentPaymentKeysCache = { network: NeuraiChainType; secret: string; passphrase: string; keys: SilentPaymentKeys };

/** A payment to the wallet's silent payment code. `tweak` is secret: with
 * the spend key it gives the private key of the output. */
export type ReceivedSilentPayment = { txid: string; vout: number; address: string; tweak: string; height: number };

/** An unspent coin on a silent payment address. */
export type SilentPaymentCoin = SpendableUtxo & { height: number };

/** Index blocks per request, the most the node serves at once. */
const SILENT_PAYMENT_PAGE = 1000;

export class NeuraiECDSAWallet extends AbstractNeuraiWallet {
  static readonly type = 'NeuraiECDSA';
  static readonly typeReadable = 'Neurai ECDSA';
  // @ts-ignore: override
  public readonly type = NeuraiECDSAWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = NeuraiECDSAWallet.typeReadable;

  /** Payments to the silent payment code found so far. Persisted. */
  _silentPayments: ReceivedSilentPayment[];
  /** Last index block scanned, the anchor of the next request; null before
   * the first scan. Persisted. */
  _silentPaymentScan: { height: number; hash: string } | null;
  /** Set on wallets created here: nothing paid their code before, so the
   * first scan starts at the tip instead of reading the whole index. Persisted. */
  _silentPaymentScanFromTip: boolean;
  /** Identity keys and what they were derived from. Not persisted. */
  private _silentPaymentKeys: SilentPaymentKeysCache | null;
  /** Scan in flight, shared by concurrent callers. */
  private _silentPaymentSync: Promise<boolean> | null;
  /** Bumped when the identity changes, so a scan started before stops. */
  private _silentPaymentEpoch: number;

  constructor() {
    super();
    this.network = chainFor('testnet', 'ecdsa');
    this._silentPayments = [];
    this._silentPaymentScan = null;
    this._silentPaymentScanFromTip = false;
    this._silentPaymentKeys = null;
    this._silentPaymentSync = null;
    this._silentPaymentEpoch = 0;
    Object.defineProperty(this, '_silentPaymentKeys', { writable: true, enumerable: false, value: null });
    Object.defineProperty(this, '_silentPaymentSync', { writable: true, enumerable: false, value: null });
    Object.defineProperty(this, '_silentPaymentEpoch', { writable: true, enumerable: false, value: 0 });
  }

  get walletKind(): WalletKind {
    return 'ecdsa';
  }

  generate(): string {
    const mnemonic = super.generate();
    this._silentPaymentScanFromTip = true;
    return mnemonic;
  }

  setSecret(newSecret: string): this {
    super.setSecret(newSecret);
    this._forgetSilentPayments();
    return this;
  }

  setPassphrase(passphrase: string): void {
    super.setPassphrase(passphrase);
    this._forgetSilentPayments();
  }

  setNetwork(network: NeuraiChainType): void {
    if (network === this.network) return;
    super.setNetwork(network);
    this._forgetSilentPayments();
  }

  protected discardTestnetChainState(): void {
    super.discardTestnetChainState();
    this._forgetSilentPayments();
  }

  private _forgetSilentPayments(): void {
    this._silentPayments = [];
    this._silentPaymentScan = null;
    this._silentPaymentScanFromTip = false;
    this._silentPaymentSync = null;
    this._silentPaymentEpoch++;
  }

  /**
   * NIP-047 keys of this wallet's words and passphrase: the identity the
   * node's `-addresstype=ecdsa` wallet has for that seed. The derivation runs
   * PBKDF2 on the JS thread, so the keys are kept for the session, like the
   * engine keeps the wallet's other keys.
   */
  private _getSilentPaymentKeys(): SilentPaymentKeys {
    const cached = this._silentPaymentKeys;
    if (cached && cached.network === this.network && cached.secret === this.secret && cached.passphrase === this.passphrase) {
      return cached.keys;
    }
    const keys = deriveKeysFromMnemonic(this.secret, this.passphrase, silentPaymentNetworkFor(this.network));
    this._silentPaymentKeys = { network: this.network, secret: this.secret, passphrase: this.passphrase, keys };
    return keys;
  }

  /** Silent payment code (`nsp1…` / `tnsp1…`). Every payment to it arrives at a new strict ECDSA v3 address. */
  getSilentPaymentCode(): string {
    return this._getSilentPaymentKeys().code;
  }

  /**
   * Scan the node's NIP-047 index from the last block seen up to the tip.
   * Payments found join the wallet's balance and history, and are spent only
   * through {@link buildSilentPaymentCoinsTransaction}. Resolves to true when
   * the payments changed. Never rejects: a failed scan
   * is logged and resumed on the next one. Concurrent callers share a scan.
   */
  syncSilentPayments(): Promise<boolean> {
    if (!isKindAvailable(this.getNeuraiNetwork(), 'ecdsa') || !this.secret) return Promise.resolve(false);
    if (!this._silentPaymentSync) {
      const sync = this._scanSilentPayments()
        .catch(err => {
          console.debug('NeuraiECDSAWallet: silent payment scan failed', err);
          return false;
        })
        .finally(() => {
          if (this._silentPaymentSync === sync) this._silentPaymentSync = null;
        });
      this._silentPaymentSync = sync;
    }
    return this._silentPaymentSync;
  }

  private async _scanSilentPayments(): Promise<boolean> {
    const epoch = this._silentPaymentEpoch;
    const backend = this.getBackend();
    const chain = { network: silentPaymentNetworkFor(this.network) };
    let next: number;
    let anchor = '';
    if (this._silentPaymentScan) {
      next = this._silentPaymentScan.height + 1;
      anchor = this._silentPaymentScan.hash;
    } else {
      const info = await backend.rpc<{ enabled?: boolean; start_height: number; synced_height: number; synced_hash: string }>(
        'getsilentpaymentindexinfo',
        [],
      );
      if (epoch !== this._silentPaymentEpoch || !info?.enabled) return false;
      if (this._silentPaymentScanFromTip) {
        this._silentPaymentScan = { height: info.synced_height, hash: info.synced_hash };
        return false;
      }
      next = info.start_height;
    }

    const keys = this._getSilentPaymentKeys();
    let changed = false;
    for (;;) {
      const raw = await backend.rpc<unknown>('getsilentpaymenttweaksrange', [next, SILENT_PAYMENT_PAGE, anchor, 'hex']);
      if (epoch !== this._silentPaymentEpoch) return false;
      // A reorganisation is answered in JSON even when hex was asked for.
      const page = typeof raw === 'string' ? decodeIndexMessage(raw, chain) : parseIndexResponse(raw, chain);
      if (page.type === 'reorg') {
        // Payments above the fork may be gone: forget them and scan again from there.
        const kept = this._silentPayments.filter(p => p.height <= page.forkHeight);
        changed = changed || kept.length !== this._silentPayments.length;
        this._silentPayments = kept;
        next = page.forkHeight + 1;
        anchor = '';
        continue;
      }
      if (page.type !== 'range') throw new Error('Unexpected silent payment index answer');
      for (const p of scanTweaks(page.blocks, keys, chain)) {
        if (this._silentPayments.some(q => q.txid === p.txid && q.vout === p.vout)) continue;
        this._silentPayments.push({
          txid: p.txid,
          vout: p.vout,
          address: p.address,
          tweak: Buffer.from(p.tweak).toString('hex'),
          height: p.height ?? 0,
        });
        changed = true;
      }
      const last = page.blocks[page.blocks.length - 1];
      if (last) {
        this._silentPaymentScan = { height: last.height, hash: last.hash };
        anchor = last.hash;
      }
      next = page.nextHeight;
      if (page.status !== 'more' || page.blocks.length === 0) break;
    }
    return changed;
  }

  /**
   * Unspent coins on the silent payment addresses, largest first, without the
   * ones a transaction in the mempool already spends.
   */
  async listSilentPaymentCoins(): Promise<SilentPaymentCoin[]> {
    const addresses = this._silentPayments.map(p => p.address);
    if (addresses.length === 0) return [];
    const backend = this.getBackend();
    const [utxos, mempool] = await Promise.all([backend.getUtxos(addresses), backend.getMempool(addresses)]);
    const spentInMempool = new Set(mempool.map(m => `${m.prevtxid}:${m.prevout}`));
    const heights = new Map(this._silentPayments.map(p => [p.address, p.height]));
    return utxos
      .filter(u => (u.assetName === 'XNA' || !u.assetName) && u.satoshis > 0n && !spentInMempool.has(`${u.txid}:${u.outputIndex}`))
      .map(u => ({
        ...u,
        assetName: 'XNA',
        // The wallet service sends no scripts; the signer needs the prevout's.
        script: u.script || Buffer.from(encodeDestinationScript(u.address)).toString('hex'),
        height: u.height ?? heights.get(u.address) ?? 0,
      }))
      .sort((a, b) => (a.satoshis === b.satoshis ? 0 : a.satoshis < b.satoshis ? 1 : -1));
  }

  /**
   * Spend exactly `coins` (from {@link listSilentPaymentCoins}) to `to`, an
   * address or a payment code. They never mix with the wallet's other coins,
   * and the change goes back to the wallet's own code as a new silent
   * payment, so nothing on chain ties them to the rest of the wallet. `amount`
   * null sends everything, fee deducted, without change.
   */
  async buildSilentPaymentCoinsTransaction(
    coins: SilentPaymentCoin[],
    to: string,
    amount: string | null,
  ): Promise<NeuraiBuildTransactionResult> {
    if (this.amountsStale) throw new Error('Refresh this wallet before sending');
    if (coins.length === 0) throw new Error('Select the coins to spend');
    const network = silentPaymentNetworkFor(this.network);
    const toCode = looksLikeSilentPaymentCode(to);
    if (toCode) {
      const check = checkCode(to, network);
      if (!check.valid) throw new Error(`Invalid silent payment code (${check.reason})`);
    } else if (!this.isAddressValid(to)) {
      throw new Error('Invalid address');
    }

    const payments = new Map(this._silentPayments.map(p => [p.address, p]));
    const { spendPrivateKey } = this._getSilentPaymentKeys();
    const wifs: Record<string, string> = {};
    for (const coin of coins) {
      const payment = payments.get(coin.address);
      if (!payment) throw new Error(`Not a silent payment of this wallet: ${coin.address}`);
      wifs[coin.address] = paymentPrivateKeyWIF(spendPrivateKey, payment.tweak, network);
    }

    // Outputs to payment codes are strict v3, like the coins' own addresses.
    const v3Address = coins[0].address;
    const recipientAddress = toCode ? v3Address : to;
    const feeRate = await this.estimateFeeRate();
    const feeFor = (withChange: boolean) =>
      estimateNeuraiFeeSats(
        coins.map(c => c.script),
        withChange ? [recipientAddress, v3Address] : [recipientAddress],
        feeRate,
      );
    const totalSats = coins.reduce((sum, c) => sum + c.satoshis, 0n);
    let amountSats: bigint;
    let feeSats: bigint;
    let changeSats = 0n;
    if (amount === null) {
      feeSats = feeFor(false);
      amountSats = totalSats - feeSats;
    } else {
      amountSats = xnaToSats(amountFromInput(amount));
      feeSats = feeFor(true);
      changeSats = totalSats - amountSats - feeSats;
      if (changeSats < 0n) throw new Error('The selected coins do not cover the amount and the network fee');
      // Fold a sub-dust change into the fee rather than emitting an unspendable output.
      if (changeSats < dustThresholdSats(v3Address)) {
        feeSats += changeSats;
        changeSats = 0n;
      }
    }
    if (amountSats < dustThresholdSats(recipientAddress)) throw new Error('Amount too low to cover the network fee');

    const outputs: SilentPaymentOutput[] = [toCode ? { code: to, valueSats: amountSats } : { address: to, valueSats: amountSats }];
    if (changeSats > 0n) outputs.push({ code: this.getSilentPaymentCode(), valueSats: changeSats });
    const { signedHex, unsignedHex, derived } = this._signSilentPayment(coins, wifs, outputs, this.getEngineNetwork());
    return {
      signedHex,
      unsignedHex,
      feeSats,
      sentAmountSats: amountSats,
      netDebitSats: amountSats + feeSats,
      debug: { silentPaymentCoins: coins.length, changeSats, derived: derived.map(d => d.address) },
    };
  }

  /**
   * Scan without making the caller wait: the first scan reads the whole index
   * (seconds), later ones a few blocks. Balance and history are fetched again
   * when it finds something.
   */
  private _syncSilentPaymentsInBackground(): void {
    this.syncSilentPayments().then(changed => changed && this._refetchInBackground());
  }

  /** Balance and history include the payments to the code. The engine does
   * not hold them, so its sends never spend them along with other coins. */
  protected async _walletAddresses(): Promise<string[]> {
    this._syncSilentPaymentsInBackground();
    const addresses = await super._walletAddresses();
    const own = new Set(addresses);
    return [...addresses, ...this._silentPayments.map(p => p.address).filter(a => !own.has(a))];
  }

  /** Payments to the code have new addresses, so no `address.changed` announces them: look at every block. */
  protected _onNewBlock(): void {
    this._syncSilentPaymentsInBackground();
  }

  /**
   * Sweep all UTXOs held by an external WIF private key into this wallet. The
   * engine collects the Legacy and the ECDSA witness v3 address of the key.
   */
  async sweep(wif: string, broadcast: boolean): Promise<unknown> {
    const engine = await this.ensureEngine();
    return engine.sweep(wif, broadcast);
  }

  allowSweepFromWif(): boolean {
    return true;
  }

  static forNetwork(network: NeuraiNetwork, mnemonic: string, passphrase = ''): NeuraiECDSAWallet {
    const wallet = new NeuraiECDSAWallet();
    wallet.setSecret(mnemonic);
    wallet.setPassphrase(passphrase);
    wallet.setNetwork(chainFor(network, 'ecdsa'));
    return wallet;
  }
}
