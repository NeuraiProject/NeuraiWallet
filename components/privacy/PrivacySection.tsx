/**
 * Privacy tab of a testnet wallet (C7 TEST pool), laid out like the DePIN
 * section: a header card (status badge, pool chips, private balance and
 * address, gear for the advanced settings), folder tabs for the operations
 * and a short activity list. Switching pools keeps the others' sessions open.
 * The proving engine (hidden WebView) lives only while this tab is open.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { formatXna } from '@neuraiproject/neurai-privacy/client';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_PRIVACY_POOL, PRIVACY_POOLS, type C6Runtime, type PrivacyPoolId } from '../../blue_modules/neurai/privacy/deployment';
import type { PrivacyWallet } from '../../blue_modules/neurai/privacy/wallet';
import { useC6Operations } from '../../hooks/useC6Operations';
import { useC6PrivateWallet } from '../../hooks/useC6PrivateWallet';
import useScrollAboveKeyboard from '../../hooks/useScrollAboveKeyboard';
import { isNeuraiWallet } from '../../class/wallets/is-neurai-wallet';
import { useStorage } from '../../hooks/context/useStorage';
import loc from '../../loc';
import QRCode from '../QRCode';
import { C6OperationsPanel, actionLabel } from './C6OperationsPanel';
import { C6SettingsSheet } from './C6SettingsSheet';
import {
  Badge,
  Card,
  Chip,
  ChipRow,
  ErrorBox,
  Hint,
  IconButton,
  Label,
  PrimaryButton,
  ProgressLine,
  TestBadge,
  usePrivacyTheme,
  type BadgeTone,
} from './C6UI';
import { PrivacyHostProvider } from './PrivacyHost';

const poolLabel = (_id: PrivacyPoolId) => 'C7 · XNA';

/** Seconds since `busy` turned on. */
function useElapsed(busy: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  return seconds;
}

function PoolView({
  wallet,
  runtime,
  poolId,
  onPool,
  hidden,
}: {
  wallet: PrivacyWallet;
  runtime: C6Runtime;
  poolId: PrivacyPoolId;
  onPool: (id: PrivacyPoolId) => void;
  hidden: boolean;
}) {
  const t = usePrivacyTheme();
  const insets = useSafeAreaInsets();
  const pool = useC6PrivateWallet(wallet, runtime, hidden);
  const ops = useC6Operations(wallet, runtime, pool);
  const [zkPassphrase, setZkPassphrase] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [settings, setSettings] = useState(false);
  // The settings sheet is a modal with its own fields: leave its keyboard alone.
  const keyboard = useScrollAboveKeyboard(!hidden && !settings);

  const busy = pool.busy;
  const unit = ops.unit;
  const pending = !!ops.preview || !!ops.fundingPreview;
  const address = pool.receiving?.current?.address ?? '';
  const elapsed = useElapsed(busy);

  const unlock = useCallback(() => pool.run(loc.privacy.opening, () => pool.unlock({ zkPassphrase })), [pool, zkPassphrase]);
  const lock = useCallback(() => {
    pool.lock();
    setShowQr(false);
  }, [pool]);

  // The journal keeps a published but unconfirmed operation as `prepared`.
  const published = new Set(ops.publishedTxids);
  const opStatus = (op: { outcome: string | null; phase: string; txid: string | null }) =>
    op.outcome ?? (published.has(op.txid ?? '') ? loc.privacy.pending : op.phase);

  const badge: { label: string; tone: BadgeTone } = pool.error
    ? { label: loc.privacy.badge_error, tone: 'error' }
    : busy
      ? { label: loc.privacy.badge_working, tone: 'busy' }
      : !pool.open
        ? { label: loc.privacy.badge_locked, tone: 'off' }
        : pool.historyReady
          ? { label: loc.privacy.badge_ready, tone: 'ok' }
          : { label: loc.privacy.badge_read_only, tone: 'busy' };

  const summary = pool.open ? pool.summary : null;
  const status = busy ? (
    <ProgressLine text={pool.phase} seconds={elapsed} onCancel={lock} cancelLabel={loc.privacy.cancel} />
  ) : summary?.tip ? (
    <Hint lines={1}>{pool.sync.syncing ? loc.privacy.refreshing : `${loc.privacy.synced_block} ${summary.tip.height}`}</Hint>
  ) : null;

  return (
    <ScrollView
      ref={keyboard.scrollRef}
      style={[styles.flex, { backgroundColor: t.colors.background, marginBottom: keyboard.bottomInset }]}
      contentContainerStyle={[styles.content, { paddingBottom: (insets.bottom || 0) + 16 }]}
      keyboardShouldPersistTaps="handled"
      onLayout={keyboard.onLayout}
      onScroll={keyboard.onScroll}
      scrollEventThrottle={16}
    >
      <Card badge={<Badge label={badge.label} tone={badge.tone} />}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, t.text]}>{loc.privacy.title}</Text>
          <Text style={[styles.subtitle, t.subtext]}>{` — ${runtime.generation}`}</Text>
          <TestBadge label="TEST" />
        </View>

        <ChipRow>
          {PRIVACY_POOLS.filter(p => p.runtime).map(p => (
            <Chip
              key={p.id}
              label={poolLabel(p.id)}
              active={p.id === poolId}
              disabled={busy || pending}
              onPress={() => onPool(p.id)}
              testID={`PrivacyPool-${p.id}`}
            />
          ))}
        </ChipRow>

        <View style={styles.section}>
          <Label>{loc.privacy.private_balance}</Label>
          <Text style={[styles.balance, t.text]} numberOfLines={1} adjustsFontSizeToFit>
            {summary ? `${formatXna(summary.balanceAtomic)} ${unit}` : '—'}
          </Text>
          {summary ? (
            <Hint
              lines={1}
            >{`${loc.privacy.available} ${formatXna(summary.spendableAtomic)} · ${loc.privacy.notes_count} ${summary.notes.length}`}</Hint>
          ) : null}
        </View>

        {pool.open ? (
          <View style={styles.section}>
            <Label>{loc.privacy.private_address}</Label>
            <Text style={[styles.address, t.text]} numberOfLines={1} ellipsizeMode="middle">
              {address || '—'}
            </Text>
            <View style={styles.addressActions}>
              <ChipRow>
                <Chip
                  label={loc.privacy.copy}
                  disabled={!address}
                  onPress={() => Clipboard.setString(address)}
                  testID="PrivacyCopyAddress"
                />
                <Chip label={showQr ? loc.privacy.hide_qr : loc.privacy.show_qr} disabled={!address} onPress={() => setShowQr(v => !v)} />
                <Chip
                  label={loc.privacy.new_address}
                  disabled={busy || !pool.historyReady}
                  onPress={() =>
                    pool.run(loc.privacy.new_address, async token => {
                      pool.update(await pool.requireClient().newAddress());
                      pool.live(token);
                      pool.setSaved(false);
                    })
                  }
                />
              </ChipRow>
            </View>
            {showQr && address ? (
              <View style={styles.qr}>
                <QRCode value={address} size={200} />
              </View>
            ) : null}
            {!pool.historyReady ? (
              <View style={styles.section}>
                <Hint>{loc.privacy.no_history}</Hint>
                <View style={styles.addressActions}>
                  <ChipRow>
                    <Chip label={loc.privacy.restore_backup} disabled={busy} onPress={() => setSettings(true)} />
                    <Chip
                      label={loc.privacy.new_history}
                      disabled={busy}
                      onPress={() => pool.run(loc.privacy.opening, () => pool.unlock({ create: true, zkPassphrase }))}
                    />
                  </ChipRow>
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <PrimaryButton title={loc.privacy.open_wallet} onPress={unlock} disabled={!pool.valid} busy={busy} testID="PrivacyOpen" />
          </View>
        )}

        <View style={styles.footer}>
          <View style={styles.flex}>{status}</View>
          <IconButton name="settings" label={loc.privacy.settings} onPress={() => setSettings(true)} testID="PrivacySettings" />
        </View>
        {pool.blockedReason ? <ErrorBox message={pool.blockedReason} /> : null}
        {pool.error ? <ErrorBox message={pool.error} /> : null}
      </Card>

      {pool.open ? (
        <View style={styles.section}>
          <C6OperationsPanel wallet={wallet} pool={pool} ops={ops} />
        </View>
      ) : null}

      {pool.open && pool.operations.length ? (
        <View style={styles.section}>
          <Card>
            <Text style={[styles.cardTitle, t.text]}>{loc.privacy.activity}</Text>
            {pool.operations
              .slice()
              .reverse()
              .slice(0, 8)
              .map(op => (
                <View key={op.id} style={styles.activityRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.activityTitle, t.text]}>{`${actionLabel(op.action)} · ${opStatus(op)}`}</Text>
                    <Text style={[styles.activityId, t.subtext]} numberOfLines={1} ellipsizeMode="middle">
                      {op.txid ?? op.id}
                    </Text>
                  </View>
                  {!op.outcome && op.phase === 'prepared' && !published.has(op.txid ?? '') ? (
                    <Chip label={loc.privacy.resume} disabled={busy || pending} onPress={() => ops.resumeXna(op.id)} />
                  ) : null}
                  {!op.outcome && op.phase === 'draft' ? (
                    <Chip label={loc.privacy.release} disabled={busy} onPress={() => ops.releaseDraft(op.id)} />
                  ) : null}
                </View>
              ))}
          </Card>
        </View>
      ) : null}

      <C6SettingsSheet
        visible={settings}
        onClose={() => setSettings(false)}
        runtime={runtime}
        pool={pool}
        zkPassphrase={zkPassphrase}
        onZkPassphrase={setZkPassphrase}
        onLock={lock}
        backupName={`neurai-${runtime.generation.toLowerCase()}-private.encrypted.json`}
      />
    </ScrollView>
  );
}

/**
 * `hidden`: the section stays mounted behind another wallet tab or screen so an
 * opened private wallet stays open; meanwhile its background scans wait.
 */
export default function PrivacySection({ walletID, hidden = false }: { walletID: string; hidden?: boolean }) {
  // The wallet itself, not the screen's subscription proxy: that proxy is
  // replaced after every transaction fetch, which would lock the private wallet.
  const { wallets } = useStorage();
  const found = wallets.find(w => w.getID() === walletID);
  const wallet = isNeuraiWallet(found) ? (found as unknown as PrivacyWallet) : undefined;
  const [poolId, setPoolId] = useState<PrivacyPoolId>(DEFAULT_PRIVACY_POOL);
  // Every pool shown in this tab stays mounted behind the selected one, so a
  // private wallet opened there stays open; its background scans wait.
  const [visited, setVisited] = useState<PrivacyPoolId[]>([DEFAULT_PRIVACY_POOL]);
  const selectPool = useCallback((id: PrivacyPoolId) => {
    setPoolId(id);
    setVisited(current => (current.includes(id) ? current : [...current, id]));
  }, []);
  const pools = PRIVACY_POOLS.flatMap(p => (p.runtime && visited.includes(p.id) ? [{ id: p.id, runtime: p.runtime }] : []));
  return (
    <PrivacyHostProvider>
      {wallet
        ? pools.map(p => (
            <View key={`${walletID}:${p.runtime.id}`} style={p.id === poolId ? styles.flex : styles.hidden}>
              <PoolView wallet={wallet} runtime={p.runtime} poolId={p.id} onPool={selectPool} hidden={hidden || p.id !== poolId} />
            </View>
          ))
        : null}
    </PrivacyHostProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
  content: { padding: 16 },
  section: { marginTop: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', columnGap: 4, marginBottom: 12, paddingRight: 70 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13, fontWeight: '600', fontStyle: 'italic', marginRight: 4 },
  balance: { fontSize: 26, fontWeight: '700' },
  address: { fontSize: 14, fontWeight: '600' },
  addressActions: { marginTop: 10 },
  qr: { alignItems: 'center', marginTop: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', columnGap: 8, marginTop: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  activityRow: { flexDirection: 'row', alignItems: 'center', columnGap: 8, marginTop: 10 },
  activityTitle: { fontSize: 13, fontWeight: '600' },
  activityId: { fontSize: 11, fontFamily: 'monospace' },
});
