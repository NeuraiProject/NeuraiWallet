/**
 * Pool operations of an opened private wallet: deposit, assign (transfer),
 * withdraw and join, for the XNA pool (fees paid from the note) and the asset
 * pool (fees paid by an XNA sponsor coin). Port of the web wallet's
 * `C6XnaPrivacyPool` / `C6AssetPrivacyPool` logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  admitTransaction,
  c6AssetMetadata,
  c6ReadAssetTransfer,
  confirmedPoolCoins,
  formatXna,
  inspectFundingTransaction,
  parseAssetAmount,
  parseXna,
  publishTransaction,
  rpcAmountToSatoshis,
  withdrawalScript,
  type C6PreparedAuthorization,
  type PoolCoin,
} from '@neuraiproject/neurai-privacy/client';
import { hexToBytes } from '@noble/hashes/utils';

import type { C6Runtime } from '../blue_modules/neurai/privacy/deployment';
import { tagPrivacyTxs } from '../blue_modules/neurai/privacy/txTags';
import { c6FundingAddresses, signPoolInputs, type PrivacyWallet } from '../blue_modules/neurai/privacy/wallet';
import { useSettings } from './context/useSettings';
import type { C6PrivateWallet } from './useC6PrivateWallet';
import loc from '../loc';

export type C6Action = 'deposit' | 'transfer' | 'withdraw' | 'join';
export type AssetCoin = { point: string; txid: string; vout: number; quantityAtomic: string; script: string; address: string };
export type TxPreview = {
  raw: string;
  txid: string;
  points: Array<{ txid: string; vout: number }>;
  amount?: string;
  fee: string;
  form?: string;
};
type OperationPreview = TxPreview & { operationId: string };

/** Funding outpoint as the circuit reads it: txid bytes reversed, then vout little-endian. */
export const outpointHex = (txid: string, vout: number) => {
  const bytes = txid.match(/../g)!.reverse();
  // eslint-disable-next-line no-bitwise
  for (let i = 0; i < 4; i++) bytes.push(((vout >>> (8 * i)) & 255).toString(16).padStart(2, '0'));
  return bytes.join('');
};

/** Lifetime XNA the asset sponsor journal may expose (10 XNA, as on the web). */
export const SPONSOR_BUDGET_ATOMIC = '1000000000';

export function useC6Operations(wallet: PrivacyWallet, runtime: C6Runtime, pool: C6PrivateWallet) {
  const { rpc, live } = pool;
  const { isPQAddressReuseEnabled } = useSettings();
  const isAsset = runtime.kind === 'asset';
  const meta = useMemo(() => (isAsset ? c6AssetMetadata(runtime.config.manifest as never) : null), [isAsset, runtime]);
  const unit = meta?.name ?? 'XNA';
  const genesis = useMemo(() => ({ genesis: runtime.config.deployment.genesis }), [runtime]);
  const sponsorFees = useMemo(() => ((runtime.config.manifest as { sponsor_fees?: string[] }).sponsor_fees ?? []).map(String), [runtime]);

  const [action, setAction] = useState<C6Action>('deposit');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  const [recipients, setRecipients] = useState([{ recipient: '', amount: '' }]);
  const [fundingPreview, setFundingPreview] = useState<TxPreview | null>(null);
  const [preview, setPreview] = useState<OperationPreview | null>(null);
  const [fundingSent, setFundingSent] = useState<string | null>(null);
  // XNA: the exact confirmed coin of amount + fee, when it exists.
  const [fundingCoin, setFundingCoin] = useState<PoolCoin | null>(null);
  const [fundingChecked, setFundingChecked] = useState(false);
  // Asset: exact zero-XNA asset transfers and XNA sponsor coins.
  const [assetCoins, setAssetCoins] = useState<AssetCoin[]>([]);
  const [sponsorCoins, setSponsorCoins] = useState<PoolCoin[]>([]);
  const [selectedFunding, setSelectedFunding] = useState('');
  const [selectedSponsor, setSelectedSponsor] = useState('');
  const [resume, setResume] = useState('');
  // Transactions published in this session: shown as pending until confirmed.
  const [publishedTxids, setPublishedTxids] = useState<string[]>([]);

  const form =
    action === 'deposit' ? 'D' : action === 'withdraw' ? 'W' : action === 'join' ? 'J2' : 'T' + Math.min(3, recipients.length + 1);
  const levels: string[] = useMemo(
    () => (isAsset ? sponsorFees : ((runtime.config.manifest.fees as Record<string, string[]>)[form] ?? []).map(String)),
    [isAsset, sponsorFees, runtime, form],
  );
  useEffect(() => setFee(levels[0] ?? ''), [levels]);

  // Locking or switching discards everything captured for review.
  useEffect(() => {
    if (pool.open) return;
    setPreview(null);
    setFundingPreview(null);
    setFundingCoin(null);
    setFundingSent(null);
    setAssetCoins([]);
    setSponsorCoins([]);
    setResume('');
  }, [pool.open]);
  useEffect(() => setNotes([]), [action]);

  const parseAmount = useCallback((value: string) => (meta ? parseAssetAmount(value, meta.units) : parseXna(value)), [meta]);

  /** Smallest multiple the pool accepts: 100 XNA, or the asset's unit. */
  const quantum = useMemo(() => (meta ? BigInt(meta.unit) : 10000000000n), [meta]);

  /**
   * Why an amount breaks the pool's rules, or null: deposits and recipient
   * amounts are multiples of the quantum; an XNA withdrawal below 100 XNA must
   * empty the note (amount + fee = note).
   */
  const amountIssue = useCallback(
    (value: string, use: 'deposit' | 'recipient' | 'withdraw', noteAtomic?: string): string | null => {
      if (!value) return null;
      let atomic: bigint;
      try {
        atomic = parseAmount(value);
      } catch {
        return loc.privacy.rule_invalid;
      }
      if (atomic <= 0n) return loc.privacy.rule_invalid;
      if (use === 'withdraw' && !meta && atomic < quantum) {
        return noteAtomic !== undefined && atomic + BigInt(fee || '0') !== BigInt(noteAtomic) ? loc.privacy.rule_small_withdraw : null;
      }
      return atomic % quantum === 0n ? null : meta ? loc.privacy.rule_invalid : loc.privacy.rule_multiple;
    },
    [parseAmount, meta, quantum, fee],
  );

  // XNA deposit needs amount + fee in one exact coin.
  let requiredFunding: string | null = null;
  try {
    if (!isAsset && fee && amount) requiredFunding = String(parseXna(amount) + BigInt(fee));
  } catch {
    // Incomplete amounts are not ready to deposit.
  }

  const ownXnaCoins = useCallback(async () => {
    const [own, rows, baseCurrency] = await Promise.all([wallet.listOwnAddresses(), wallet.listOwnUtxos(), wallet.getBaseCurrencyName()]);
    const coins = await confirmedPoolCoins(rpc!, rows.filter(c => own.includes(c.address)) as never, { baseCurrency });
    return { own, coins: coins.filter(c => !!c.address && own.includes(c.address)) };
  }, [wallet, rpc]);

  const exactXnaCoin = useCallback(
    async (value: string) => (await ownXnaCoins()).coins.find(c => String(c.valueSats) === value) ?? null,
    [ownXnaCoins],
  );

  /** Asset pool: exact zero-XNA asset transfers (deposit funding) and confirmed XNA coins (sponsors). */
  const loadAssetCoins = useCallback(
    async (token: number) => {
      if (!meta) return;
      const [{ own, coins }, assetRows] = await Promise.all([ownXnaCoins(), wallet.listOwnUtxos(meta.name)]);
      live(token);
      const rows: AssetCoin[] = [];
      for (const u of assetRows) {
        if (!Number.isInteger(u.outputIndex) || u.outputIndex < 0 || !own.includes(u.address)) continue;
        const coin = await rpc!('gettxout', [u.txid, u.outputIndex, true]);
        live(token);
        if (!coin || coin.confirmations < 1 || rpcAmountToSatoshis(coin.value) !== 0n) continue;
        // Other asset types and historical payloads are ineligible, never rewritten.
        let transfer;
        try {
          transfer = c6ReadAssetTransfer(hexToBytes(coin.scriptPubKey.hex), { asset: meta.name, unit: meta.unit });
        } catch {
          continue;
        }
        const address = coin.scriptPubKey.addresses?.[0];
        if (!address || !own.includes(address)) continue;
        rows.push({
          point: `${u.txid}:${u.outputIndex}`,
          txid: u.txid,
          vout: u.outputIndex,
          quantityAtomic: transfer.amountAtomic,
          script: coin.scriptPubKey.hex,
          address,
        });
      }
      const sponsors = [...coins].sort((a, b) => (BigInt(b.valueSats) > BigInt(a.valueSats) ? 1 : -1));
      setAssetCoins(rows);
      setSponsorCoins(sponsors);
      setSelectedSponsor(current =>
        sponsors.some(c => `${c.txid}:${c.vout}` === current) ? current : sponsors[0] ? `${sponsors[0].txid}:${sponsors[0].vout}` : '',
      );
    },
    [meta, ownXnaCoins, wallet, rpc, live],
  );

  // Asset deposit: pick the funding output that matches the amount exactly.
  useEffect(() => {
    if (!isAsset || !amount) return;
    try {
      const wanted = String(parseAmount(amount));
      const match = assetCoins.find(c => c.quantityAtomic === wanted);
      if (match) setSelectedFunding(match.point);
    } catch {
      // Incomplete amount.
    }
  }, [isAsset, amount, assetCoins, parseAmount]);

  // XNA deposit: watch for the exact confirmed funding coin (every 20 s).
  const ownCoinsRef = useRef(exactXnaCoin);
  ownCoinsRef.current = exactXnaCoin;
  useEffect(() => {
    setFundingCoin(null);
    setFundingChecked(false);
    if (isAsset || !pool.open || action !== 'deposit' || !requiredFunding || !rpc) return;
    let cancelled = false;
    let pending = false;
    const wanted = requiredFunding;
    const poll = async () => {
      if (cancelled || pending || AppState.currentState !== 'active') return;
      pending = true;
      try {
        const coin = await ownCoinsRef.current(wanted);
        if (cancelled) return;
        setFundingCoin(coin);
        setFundingChecked(true);
        if (coin) setFundingSent(null);
      } catch {
        // Next poll retries; preparing a coin stays possible meanwhile.
        if (!cancelled) setFundingChecked(true);
      } finally {
        pending = false;
      }
    };
    const first = setTimeout(() => void poll(), 300);
    const timer = setInterval(() => void poll(), 20_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isAsset, pool.open, action, requiredFunding, rpc]);

  const checkedRpc = useCallback(
    (token: number) => async (method: string, params?: unknown[]) => {
      live(token);
      const result = await rpc!(method, params ?? []);
      live(token);
      return result;
    },
    [rpc, live],
  );

  /** Create the exact funding coin (XNA: amount + fee; asset: a zero-XNA transfer of the amount) to the wallet itself. */
  const prepareFunding = useCallback(
    () =>
      pool.run(loc.privacy.preparing_funding, async token => {
        const { to, change } = await c6FundingAddresses(wallet, isPQAddressReuseEnabled);
        if (!to) throw new Error(loc.privacy.error_no_address);
        const sendAmount = isAsset ? amount : formatXna(parseXna(amount) + BigInt(fee));
        parseAmount(amount);
        const built = await wallet.buildSendTransaction([{ address: to, amount: sendAmount }], {
          forcedChangeAddress: change,
          ...(isAsset ? { assetName: unit } : {}),
        });
        live(token);
        const admitted = await admitTransaction(rpc!, built.signedHex);
        live(token);
        const checked = await inspectFundingTransaction(rpc!, built.signedHex);
        live(token);
        setFundingPreview({
          raw: built.signedHex,
          txid: admitted.txid,
          points: checked.points,
          amount: sendAmount,
          fee: formatXna(checked.feeAtomic),
        });
      }),
    [pool, wallet, isPQAddressReuseEnabled, isAsset, amount, fee, unit, parseAmount, rpc, live],
  );

  const publishFunding = useCallback(
    () =>
      pool.run(loc.privacy.publishing, async token => {
        const p = fundingPreview;
        if (!p) return;
        await publishTransaction(checkedRpc(token), genesis, p);
        tagPrivacyTxs(wallet.getID(), [[p.txid, 'other']]);
        live(token);
        setFundingSent(p.txid);
        setFundingPreview(null);
      }),
    [pool, wallet, fundingPreview, checkedRpc, genesis, live],
  );

  /** The operation request the worker proves, from the current form. */
  const buildRequest = useCallback(
    async (token: number, coin?: { txid: string; vout: number; value: string }) => {
      const request: Record<string, unknown> = { action, fee: isAsset ? '0' : fee };
      if (isAsset) Object.assign(request, { sponsorPoint: selectedSponsor, sponsorFee: fee });
      if (action === 'deposit') {
        if (!coin) throw new Error(loc.privacy.error_no_funding);
        Object.assign(request, {
          amountAtomic: String(parseAmount(amount)),
          funding: outpointHex(coin.txid, coin.vout),
          fundingPoint: `${coin.txid}:${coin.vout}`,
          fundingValue: coin.value,
        });
      } else if (action === 'join') {
        if (notes.length !== 2) throw new Error(loc.privacy.error_two_notes);
        request.notes = notes;
      } else {
        if (!notes[0]) throw new Error(loc.privacy.error_pick_note);
        request.note = notes[0];
        if (action === 'transfer') {
          request.recipients = recipients.map(r => ({ recipient: r.recipient.trim(), amountAtomic: String(parseAmount(r.amount)) }));
        } else {
          request.amountAtomic = String(parseAmount(amount));
          request.payoutScript = await withdrawalScript(rpc!, destination.trim());
          live(token);
        }
      }
      return request;
    },
    [action, isAsset, fee, selectedSponsor, parseAmount, amount, notes, recipients, rpc, destination, live],
  );

  /** XNA: sign the funding input (deposits), record it, check admission and show the review. */
  const reviewXna = useCallback(
    async (result: any, token: number, shownAmount?: string) => {
      const client = pool.requireClient();
      let raw: string = result.transaction.raw;
      if (result.transaction.funding) {
        const coin = await exactXnaCoin(result.transaction.funding.valueAtomic);
        live(token);
        if (!coin || `${coin.txid}:${coin.vout}` !== result.transaction.funding.point) throw new Error(loc.privacy.error_original_funding);
        raw = await signPoolInputs(
          wallet,
          raw,
          [
            {
              address: coin.address!,
              assetName: await wallet.getBaseCurrencyName(),
              txid: coin.txid,
              outputIndex: coin.vout,
              script: coin.scriptHex,
              satoshis: String(coin.valueSats),
              value: String(coin.valueSats),
            },
          ],
          { [result.transaction.funding.index]: 1 },
        );
        live(token);
      }
      const signed = await client.recordSigned(result.operationId, raw);
      live(token);
      await admitTransaction(rpc!, raw);
      live(token);
      pool.update(signed);
      pool.setSaved(false);
      setPreview({
        operationId: signed.operationId,
        raw: signed.raw,
        txid: signed.txid,
        points: signed.inputPoints,
        form: result.transaction.form,
        fee: formatXna(result.transaction.feeAtomic),
        amount: shownAmount,
      });
    },
    [pool, exactXnaCoin, wallet, rpc, live],
  );

  /** XNA pool: prove the selected operation and show its review. */
  const prepareXna = useCallback(
    () =>
      pool.run(loc.privacy.stage_proving, async token => {
        if (!pool.historyReady) throw new Error(loc.privacy.error_history_first);
        let coin;
        if (action === 'deposit') {
          const found = requiredFunding ? await exactXnaCoin(requiredFunding) : null;
          live(token);
          if (!found) throw new Error(loc.privacy.error_no_funding);
          coin = { txid: found.txid, vout: found.vout, value: String(found.valueSats) };
        }
        const result = await pool.requireClient().prepare(await buildRequest(token, coin));
        live(token);
        await reviewXna(result, token, action === 'deposit' || action === 'withdraw' ? amount : undefined);
      }),
    [pool, action, requiredFunding, exactXnaCoin, live, buildRequest, reviewXna, amount],
  );

  const publishXna = useCallback(
    () =>
      pool.run(loc.privacy.publishing, async token => {
        const p = preview;
        if (!p) return;
        await pool.requireClient().broadcastAttempt(p.operationId);
        live(token);
        await publishTransaction(checkedRpc(token), genesis, { raw: p.raw, txid: p.txid, points: p.points });
        live(token);
        setPublishedTxids(list => [...list, p.txid]);
        setPreview(null);
        // A published form must not be sent again by accident.
        setAmount('');
        setRecipients([{ recipient: '', amount: '' }]);
        setNotes([]);
        pool.update(await pool.requireClient().scan());
        live(token);
      }),
    [pool, preview, live, checkedRpc, genesis],
  );

  /** Asset pool: prove (or resume) the operation and sign its funding input; the sponsor journal signs the fee. */
  const prepareAsset = useCallback(async (): Promise<C6PreparedAuthorization> => {
    if (!pool.open || !pool.historyReady) throw new Error(loc.privacy.error_history_first);
    if (pool.running.current) throw new Error(loc.privacy.error_running);
    const token = pool.epoch.current;
    pool.running.current = true;
    pool.setBusy(true);
    pool.setError('');
    try {
      await pool.sync.wait();
      live(token);
      if (!sponsorCoins.some(c => `${c.txid}:${c.vout}` === selectedSponsor)) throw new Error(loc.privacy.error_no_sponsor);
      let coin: AssetCoin | undefined;
      if (action === 'deposit') {
        coin = assetCoins.find(c => c.point === selectedFunding);
        if (!coin) throw new Error(loc.privacy.error_no_funding);
        if (String(parseAmount(amount)) !== coin.quantityAtomic) throw new Error(loc.privacy.error_asset_quantity);
      }
      const client = pool.requireClient();
      const result = resume
        ? await client.rebuild(resume, { sponsorPoint: selectedSponsor, sponsorFee: fee })
        : await client.prepare(await buildRequest(token, coin && { txid: coin.txid, vout: coin.vout, value: coin.quantityAtomic }));
      live(token);
      let raw: string = result.transaction.raw;
      if (result.transaction.funding) {
        const funding = coin ?? assetCoins.find(c => c.point === result.transaction.funding.point);
        if (!funding) throw new Error(loc.privacy.error_original_funding);
        raw = await signPoolInputs(
          wallet,
          raw,
          [
            {
              address: funding.address,
              assetName: unit,
              txid: funding.txid,
              outputIndex: funding.vout,
              script: funding.script,
              satoshis: funding.quantityAtomic,
              value: funding.quantityAtomic,
            },
          ],
          { [result.transaction.funding.index]: 1 },
        );
        live(token);
      }
      const signed = await client.recordSigned(result.operationId, raw);
      live(token);
      pool.update(signed);
      pool.setSaved(false);
      setResume('');
      return {
        raw,
        pool: runtime.config.expectedCommitment,
        notes: result.sponsorNotes,
        budgetAtomic: String(BigInt(fee) * 2n),
        offer: result.transaction.sponsor,
      };
    } finally {
      if (pool.epoch.current === token) {
        pool.running.current = false;
        pool.setBusy(false);
      }
    }
  }, [
    pool,
    live,
    sponsorCoins,
    selectedSponsor,
    action,
    assetCoins,
    selectedFunding,
    parseAmount,
    amount,
    resume,
    fee,
    buildRequest,
    wallet,
    unit,
    runtime,
  ]);

  const resumeXna = useCallback(
    (id: string) =>
      pool.run(loc.privacy.stage_proving, async token => {
        const result = await pool.requireClient().rebuild(id);
        live(token);
        await reviewXna(result, token);
      }),
    [pool, live, reviewXna],
  );

  const releaseDraft = useCallback(
    (id: string) =>
      pool.run(loc.privacy.releasing, async token => {
        pool.update(await pool.requireClient().releaseDraft(id));
        live(token);
      }),
    [pool, live],
  );

  return {
    isAsset,
    meta,
    unit,
    form,
    levels,
    action,
    setAction,
    amount,
    setAmount,
    fee,
    setFee,
    notes,
    setNotes,
    destination,
    setDestination,
    recipients,
    setRecipients,
    requiredFunding,
    fundingCoin,
    fundingChecked,
    fundingSent,
    fundingPreview,
    setFundingPreview,
    preview,
    setPreview,
    assetCoins,
    sponsorCoins,
    selectedFunding,
    setSelectedFunding,
    selectedSponsor,
    setSelectedSponsor,
    resume,
    setResume,
    publishedTxids,
    parseAmount,
    quantum,
    amountIssue,
    loadAssetCoins,
    prepareFunding,
    publishFunding,
    prepareXna,
    publishXna,
    prepareAsset,
    resumeXna,
    releaseDraft,
  };
}

export type C6Operations = ReturnType<typeof useC6Operations>;
