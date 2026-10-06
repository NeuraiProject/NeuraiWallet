/**
 * XNA sponsor journal of the C6 asset pool (port of the web wallet's sponsor
 * flow). A separate confirmed XNA coin pays each private asset operation's
 * miner fee; its signature is exposed to the pool transaction, so the journal
 * records every exposure and can sweep leftovers back to the wallet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  C6SponsorFlow,
  type C6PreparedAuthorization,
  type C6SponsorDeployment,
  type SponsorSnapshot,
} from '@neuraiproject/neurai-privacy/client';

import { usePrivacyHost } from '../components/privacy/PrivacyHost';
import { xnaToSats } from '../blue_modules/neurai/amounts';
import { LOCAL_FEE_RATE_RPC } from '../blue_modules/neurai/feePolicy';
import { createLocalLocks, FileCasStore } from '../blue_modules/neurai/privacy/store';
import { tagPrivacyTxs } from '../blue_modules/neurai/privacy/txTags';
import { createPrivacyRpc, signPoolInputs, type PrivacyWallet } from '../blue_modules/neurai/privacy/wallet';
import loc from '../loc';

let sponsorStore: FileCasStore | null = null;
const sponsorJournal = () => (sponsorStore ??= new FileCasStore('c6-sponsor-journal-v1'));
/** One lock manager per app: two screens must not spend the same sponsor coins. */
const locks = createLocalLocks();

const MIN_PASSWORD = 12;
const isMissing = (e: unknown) => e instanceof Error && /journal missing|metadata missing/.test(e.message);

export function useC6Sponsor(wallet: PrivacyWallet, deployments: C6SponsorDeployment[], budgetAtomic: string) {
  const bridge = usePrivacyHost();
  const [snapshot, setSnapshot] = useState<SponsorSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [autoSweep, setAutoSweep] = useState(false);
  const [resumable, setResumable] = useState<Array<{ operationId: string; txid: string }>>([]);
  const [prepared, setPrepared] = useState<{ operationId: string; txid: string } | null>(null);
  const [publishedTxids, setPublishedTxids] = useState<string[]>([]);
  const flow = useRef<C6SponsorFlow | null>(null);
  const active = useRef(0);
  const running = useRef(false);

  const lock = useCallback(() => {
    active.current++;
    flow.current = null;
    setSnapshot(null);
    setMissing(false);
    setPrepared(null);
    setResumable([]);
    setAutoSweep(false);
    setBusy(false);
    setPhase('');
  }, []);
  const release = useCallback(() => {
    active.current++;
    flow.current = null;
  }, []);
  useEffect(() => {
    lock();
    return release;
  }, [wallet, deployments, lock, release]);

  const run = useCallback(async (label: string, job: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    const epoch = active.current;
    setBusy(true);
    setError('');
    setPhase(label);
    try {
      await job();
    } catch (e) {
      if (active.current === epoch) {
        setError(e instanceof Error ? e.message : String(e));
        setAutoSweep(false);
      }
    } finally {
      running.current = false;
      if (active.current === epoch) {
        setBusy(false);
        setPhase('');
      }
    }
  }, []);

  const openFlow = useCallback(
    async (create: boolean, backup?: unknown) => {
      const epoch = active.current;
      const rpc = createPrivacyRpc(wallet);
      const checkedRpc = async (method: string, params?: unknown[]) => {
        if (active.current !== epoch) throw new Error(loc.privacy.error_switched);
        const result = await rpc(method, params ?? []);
        if (active.current !== epoch) throw new Error(loc.privacy.error_switched);
        return result;
      };
      const walletId = await bridge.call<string>('c6SponsorWalletId', [wallet.secret, wallet.passphrase ?? '']);
      const f = new C6SponsorFlow({
        store: sponsorJournal(),
        walletId,
        genesis: deployments[0].genesis,
        budgetAtomic,
        deployments,
        rpc: checkedRpc,
        locks,
        // The WSS service does not relay getnetworkinfo: use the app's local fee
        // policy with the same 2x margin and sizes the web wallet applies.
        sweepFeeAtomic: async offer => {
          const perKb = xnaToSats(LOCAL_FEE_RATE_RPC);
          const vsize = offer.inputScript.startsWith('52') ? 1200n : 300n;
          return String((perKb * vsize * 2n + 999n) / 1000n);
        },
        sign: async ({ raw, offer, hashType, index }) => {
          if (active.current !== epoch) throw new Error(loc.privacy.error_switched);
          const [txid, vout] = offer.outpoint.split(':');
          const tx = await checkedRpc('getrawtransaction', [txid, true]);
          const address = tx?.vout?.[Number(vout)]?.scriptPubKey?.addresses?.[0];
          if (!address || !(await wallet.listOwnAddresses()).includes(address)) throw new Error(loc.privacy.error_sponsor_wallet);
          return signPoolInputs(
            wallet,
            raw,
            [
              {
                address,
                assetName: await wallet.getBaseCurrencyName(),
                txid,
                outputIndex: Number(vout),
                script: offer.inputScript,
                satoshis: offer.inputAtomic,
                value: offer.inputAtomic,
              },
            ],
            { [index]: hashType },
          );
        },
      });
      let next: SponsorSnapshot;
      if (backup) next = await f.restore(backup as never);
      else {
        await f.initialize({ create });
        // The library rescans every block since the pool anchor: show where it is.
        next = await f.scan({
          onProgress: p => {
            if (active.current === epoch) setPhase(`${loc.privacy.stage_syncing} ${p.height}/${p.target}`);
          },
        });
      }
      if (active.current !== epoch) return;
      flow.current = f;
      setMissing(false);
      setSnapshot(next);
      setResumable(await f.pending());
    },
    [wallet, deployments, budgetAtomic, bridge],
  );

  /** Open the journal; create it only when the private wallet was never used. */
  const openOrCreate = useCallback(
    async (unused: boolean) => {
      try {
        await openFlow(false);
      } catch (e) {
        if (!isMissing(e)) throw e;
        if (!unused) {
          setMissing(true);
          throw new Error(loc.privacy.fee_journal_missing);
        }
        await openFlow(true);
      }
    },
    [openFlow],
  );
  const autoOpen = useCallback((unused: boolean) => run(loc.privacy.sponsor_opening, () => openOrCreate(unused)), [run, openOrCreate]);

  const tick = useCallback(async () => {
    const f = flow.current;
    if (!f) return;
    const epoch = active.current;
    const result = await f.tick({
      autoSweep,
      onProgress: p => {
        if (active.current === epoch) setPhase(`${loc.privacy.stage_syncing} ${p.height}/${p.target}`);
      },
    });
    if (active.current === epoch) {
      setSnapshot(result.snapshot);
      setResumable(await f.pending());
    }
  }, [autoSweep]);

  // Like the web wallet: check confirmations every 15 s while the journal is
  // open. A scan of an unchanged tip is skipped and a new block resumes from
  // the library's scan checkpoint.
  useEffect(() => {
    if (!snapshot) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && !running.current) void run(loc.privacy.stage_syncing, tick);
    }, 15_000);
    return () => clearInterval(timer);
  }, [snapshot, tick, run]);

  /**
   * Prove the asset operation, then persist its sponsor exposure and signature.
   * Opens the journal first if it is not open yet (for example after an error).
   */
  const authorize = useCallback(
    (prepare: () => Promise<C6PreparedAuthorization>, unused: boolean) =>
      run(loc.privacy.sponsor_opening, async () => {
        const epoch = active.current;
        if (!flow.current) await openOrCreate(unused);
        const f = flow.current;
        if (!f || active.current !== epoch) throw new Error(loc.privacy.error_sponsor_closed);
        setPhase(loc.privacy.stage_proving);
        const result = await prepare();
        if (active.current !== epoch) throw new Error(loc.privacy.error_switched);
        const signed = await f.authorize(result);
        if (active.current !== epoch) return;
        setPrepared(signed);
        setSnapshot(await f.snapshot());
      }),
    [run, openOrCreate],
  );

  const publish = useCallback(
    () =>
      run(loc.privacy.publishing, async () => {
        const f = flow.current;
        if (!f || !prepared) return;
        await f.publish(prepared.operationId);
        setPublishedTxids(list => [...list, prepared.txid]);
        setPrepared(null);
        await tick();
      }),
    [run, prepared, tick],
  );

  const sweep = useCallback(
    (outpoint: string) =>
      run(loc.privacy.sponsor_sweeping, async () => {
        const swept = await flow.current!.sweep(outpoint);
        tagPrivacyTxs(wallet.getID(), [[swept?.txid, 'other']]);
        await tick();
      }),
    [run, tick, wallet],
  );

  /** Encrypted backup of the sponsor journal (Argon2id in the privacy engine). */
  const backup = useCallback(
    async (password: string): Promise<string | null> => {
      const epoch = active.current;
      const f = flow.current;
      if (!f || password.length < MIN_PASSWORD) throw new Error(loc.privacy.error_password_short);
      const plain = await f.backup();
      if (active.current !== epoch || flow.current !== f) return null;
      const sealed = await bridge.call<string>('sealVault', [{ ...plain }, password]);
      return active.current === epoch && flow.current === f ? sealed : null;
    },
    [bridge],
  );

  const restore = useCallback(
    async (sealed: string, password: string) => {
      if (password.length < MIN_PASSWORD) throw new Error(loc.privacy.error_password_short);
      const plain = await bridge.call('openVault', [sealed, password]);
      await openFlow(false, plain);
    },
    [bridge, openFlow],
  );

  return {
    snapshot,
    missing,
    busy,
    phase,
    error,
    autoSweep,
    setAutoSweep,
    resumable,
    prepared,
    setPrepared,
    publishedTxids,
    run,
    lock,
    autoOpen,
    openFlow,
    tick,
    authorize,
    publish,
    sweep,
    backup,
    restore,
    minPassword: MIN_PASSWORD,
  };
}

export type C6Sponsor = ReturnType<typeof useC6Sponsor>;
