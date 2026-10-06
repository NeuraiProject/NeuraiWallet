/**
 * Operations of an opened private wallet as folder tabs (Deposit, Assign,
 * Withdraw, Join) with short forms; every transaction is reviewed before it
 * is published.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatXna } from '@neuraiproject/neurai-privacy/client';

import type { PrivacyWallet } from '../../blue_modules/neurai/privacy/wallet';
import type { C6Action, C6Operations, TxPreview } from '../../hooks/useC6Operations';
import type { C6PrivateWallet } from '../../hooks/useC6PrivateWallet';
import type { C6Sponsor } from '../../hooks/useC6Sponsor';
import loc from '../../loc';
import { Card, Chip, ChipRow, Field, FolderTabs, Hint, InfoRow, Label, OutlineButton, PrimaryButton, usePrivacyTheme } from './C6UI';

export function actionLabel(action: string): string {
  switch (action) {
    case 'deposit':
      return loc.privacy.action_deposit;
    case 'transfer':
      return loc.privacy.action_transfer;
    case 'withdraw':
      return loc.privacy.action_withdraw;
    case 'join':
      return loc.privacy.action_join;
    default:
      return action;
  }
}

function Review(props: { title: string; preview: TxPreview; unit: string; busy: boolean; onPublish: () => void; onCancel: () => void }) {
  const t = usePrivacyTheme();
  return (
    <View style={styles.review}>
      <Card>
        <Text style={[styles.reviewTitle, t.text]}>{props.title}</Text>
        {props.preview.form ? <InfoRow label={loc.privacy.circuit} value={props.preview.form} /> : null}
        {props.preview.amount ? <InfoRow label={loc.privacy.amount} value={`${props.preview.amount} ${props.unit}`} /> : null}
        <InfoRow label={loc.privacy.network_fee} value={`${props.preview.fee} XNA`} />
        <InfoRow label="TxID" value={props.preview.txid} mono />
        <View style={styles.reviewButtons}>
          <View style={styles.flex}>
            <OutlineButton title={loc.privacy.cancel} onPress={props.onCancel} disabled={props.busy} />
          </View>
          <View style={styles.flex}>
            <PrimaryButton title={loc.privacy.publish} onPress={props.onPublish} busy={props.busy} testID="PrivacyPublish" />
          </View>
        </View>
      </Card>
    </View>
  );
}

export function C6OperationsPanel({
  wallet,
  pool,
  ops,
  sponsor,
  unused,
}: {
  wallet: PrivacyWallet;
  pool: C6PrivateWallet;
  ops: C6Operations;
  sponsor: C6Sponsor;
  /** The private wallet has no notes yet: a missing fee-coin journal can be created. */
  unused: boolean;
}) {
  const busy = pool.busy || sponsor.busy;
  const pending = !!ops.preview || !!ops.fundingPreview || !!sponsor.prepared;
  const locked = busy || pending || !pool.historyReady;
  const unit = ops.unit;
  const spendable = (pool.summary?.notes ?? []).filter(n => n.spendable);

  const tabs: Array<{ key: C6Action; label: string }> = [
    { key: 'deposit', label: loc.privacy.action_deposit },
    { key: 'transfer', label: loc.privacy.action_transfer },
    { key: 'withdraw', label: loc.privacy.action_withdraw },
    { key: 'join', label: loc.privacy.action_join },
  ];

  const toggleNote = (cm: string) =>
    ops.setNotes(current => {
      if (ops.action !== 'join') return [cm];
      if (current.includes(cm)) return current.filter(n => n !== cm);
      return [...current, cm].slice(-2);
    });

  const noteChips =
    ops.action === 'deposit' ? null : (
      <View>
        <Label>{ops.action === 'join' ? loc.privacy.pick_two_notes : loc.privacy.pick_note}</Label>
        {spendable.length ? (
          <ChipRow>
            {spendable.map(n => (
              <Chip
                key={n.cm}
                label={`${formatXna(n.amountAtomic)} ${unit}`}
                active={ops.notes.includes(n.cm)}
                disabled={locked}
                onPress={() => toggleNote(n.cm)}
              />
            ))}
          </ChipRow>
        ) : (
          <Hint>{loc.privacy.no_notes}</Hint>
        )}
      </View>
    );

  const feeChips = (
    <View>
      <Label>{ops.isAsset ? loc.privacy.fee_xna : loc.privacy.fee}</Label>
      <ChipRow>
        {ops.levels.map(level => (
          <Chip
            key={level}
            label={`${formatXna(level)} XNA`}
            active={level === ops.fee}
            disabled={locked}
            onPress={() => ops.setFee(level)}
          />
        ))}
      </ChipRow>
    </View>
  );

  const sponsorChips = ops.isAsset ? (
    <View>
      <Label>{loc.privacy.fee_coin}</Label>
      {ops.sponsorCoins.length ? (
        <ChipRow>
          {ops.sponsorCoins.slice(0, 6).map(c => {
            const point = `${c.txid}:${c.vout}`;
            return (
              <Chip
                key={point}
                label={`${formatXna(String(c.valueSats))} XNA`}
                active={point === ops.selectedSponsor}
                disabled={locked}
                onPress={() => ops.setSelectedSponsor(point)}
              />
            );
          })}
        </ChipRow>
      ) : (
        <Hint>{loc.privacy.no_fee_coin}</Hint>
      )}
    </View>
  ) : null;

  const prove = () => (ops.isAsset ? sponsor.authorize(ops.prepareAsset, unused) : ops.prepareXna());
  const sponsorReady = !ops.isAsset || !!ops.selectedSponsor;
  // Editing the form clears the last operation's error.
  const setAmount = (value: string) => {
    ops.setAmount(value);
    if (pool.error) pool.setError('');
  };
  const quickAmounts = (values: Array<{ label: string; value: string }>) =>
    ops.isAsset ? null : (
      <ChipRow>
        {values.map(v => (
          <Chip key={v.label} label={v.label} active={ops.amount === v.value} disabled={locked} onPress={() => setAmount(v.value)} />
        ))}
      </ChipRow>
    );

  let body: React.ReactNode;
  if (ops.action === 'deposit') {
    const assetFundingReady = ops.isAsset && ops.assetCoins.some(c => c.point === ops.selectedFunding);
    const fundingReady = ops.isAsset ? assetFundingReady : !!ops.fundingCoin;
    const waiting = !fundingReady && !!ops.fundingSent;
    const issue = ops.amountIssue(ops.amount, 'deposit');
    const amountOk = !!ops.amount && !issue;
    body = (
      <>
        <Field
          label={loc.privacy.amount}
          value={ops.amount}
          onChangeText={setAmount}
          editable={!locked}
          keyboardType="decimal-pad"
          placeholder={ops.isAsset ? '0' : '100'}
          suffix={unit}
          testID="PrivacyAmount"
        />
        {quickAmounts(['100', '200', '500'].map(v => ({ label: `${v} XNA`, value: v })))}
        {issue ? <Hint>{issue}</Hint> : null}
        {ops.isAsset ? sponsorChips : null}
        {feeChips}
        {fundingReady ? (
          <PrimaryButton
            title={`2/2 · ${loc.privacy.action_deposit}`}
            onPress={prove}
            disabled={locked || !amountOk || !sponsorReady}
            busy={busy}
            testID="PrivacyDeposit"
          />
        ) : waiting ? (
          <PrimaryButton title={loc.privacy.waiting_confirmation} onPress={() => {}} busy />
        ) : (
          <PrimaryButton
            title={`1/2 · ${loc.privacy.prepare_funding}`}
            onPress={ops.prepareFunding}
            disabled={locked || !amountOk || (!ops.isAsset && !ops.fundingChecked)}
            busy={busy}
            testID="PrivacyPrepareFunding"
          />
        )}
      </>
    );
  } else if (ops.action === 'transfer') {
    body = (
      <>
        {noteChips}
        {ops.recipients.map((r, i) => (
          <View key={i} style={styles.recipient}>
            <Field
              label={`${loc.privacy.recipient} ${ops.recipients.length > 1 ? i + 1 : ''}`}
              value={r.recipient}
              placeholder="tnzk1…"
              editable={!locked}
              onChangeText={value => ops.setRecipients(rows => rows.map((row, j) => (j === i ? { ...row, recipient: value } : row)))}
            />
            <Field
              label={loc.privacy.amount}
              value={r.amount}
              placeholder={ops.isAsset ? '0' : '100'}
              editable={!locked}
              keyboardType="decimal-pad"
              suffix={unit}
              onChangeText={value => ops.setRecipients(rows => rows.map((row, j) => (j === i ? { ...row, amount: value } : row)))}
            />
            {ops.amountIssue(r.amount, 'recipient') ? <Hint>{ops.amountIssue(r.amount, 'recipient')}</Hint> : null}
          </View>
        ))}
        <ChipRow>
          {ops.recipients.length < 2 ? (
            <Chip
              label={`+ ${loc.privacy.recipient}`}
              disabled={locked}
              onPress={() => ops.setRecipients(rows => [...rows, { recipient: '', amount: '' }])}
            />
          ) : null}
          {ops.recipients.length > 1 ? (
            <Chip label={`− ${loc.privacy.recipient}`} disabled={locked} onPress={() => ops.setRecipients(rows => rows.slice(0, -1))} />
          ) : null}
        </ChipRow>
        {sponsorChips}
        {feeChips}
        <PrimaryButton
          title={loc.privacy.action_transfer}
          onPress={prove}
          disabled={
            locked ||
            !ops.notes[0] ||
            !sponsorReady ||
            ops.recipients.some(r => !r.recipient.trim() || !r.amount || !!ops.amountIssue(r.amount, 'recipient'))
          }
          busy={busy}
          testID="PrivacyAssign"
        />
      </>
    );
  } else if (ops.action === 'withdraw') {
    const note = spendable.find(n => n.cm === ops.notes[0]);
    const issue = ops.amountIssue(ops.amount, 'withdraw', note?.amountAtomic);
    const all =
      note && BigInt(note.amountAtomic) > BigInt(ops.fee || '0')
        ? formatXna(String(BigInt(note.amountAtomic) - BigInt(ops.fee || '0')))
        : null;
    body = (
      <>
        {noteChips}
        <Field
          label={loc.privacy.amount}
          value={ops.amount}
          onChangeText={setAmount}
          editable={!locked}
          keyboardType="decimal-pad"
          placeholder="0"
          suffix={unit}
        />
        {all ? quickAmounts([{ label: `${loc.privacy.all} · ${all} XNA`, value: all }]) : null}
        {issue ? <Hint>{issue}</Hint> : null}
        <Field
          label={loc.privacy.to_address}
          value={ops.destination}
          onChangeText={ops.setDestination}
          editable={!locked}
          placeholder="t… / tnq1r… / tpq1z…"
        />
        <ChipRow>
          <Chip
            label={loc.privacy.my_address}
            disabled={locked}
            onPress={async () => {
              const [own] = await wallet.listOwnAddresses();
              if (own) ops.setDestination(own);
            }}
          />
        </ChipRow>
        {sponsorChips}
        {feeChips}
        <PrimaryButton
          title={loc.privacy.action_withdraw}
          onPress={prove}
          disabled={locked || !ops.notes[0] || !ops.amount || !!issue || !ops.destination || !sponsorReady}
          busy={busy}
          testID="PrivacyWithdraw"
        />
      </>
    );
  } else {
    body = (
      <>
        {noteChips}
        {sponsorChips}
        {feeChips}
        <PrimaryButton
          title={loc.privacy.action_join}
          onPress={prove}
          disabled={locked || ops.notes.length !== 2 || !sponsorReady}
          busy={busy}
          testID="PrivacyJoin"
        />
      </>
    );
  }

  return (
    <View>
      <FolderTabs
        tabs={tabs}
        value={ops.action}
        onChange={a => {
          ops.setAction(a);
          ops.setResume('');
          ops.setAmount('');
          pool.setError('');
        }}
        disabled={busy || pending}
      >
        {ops.resume ? <Hint>{`${loc.privacy.resuming} ${ops.resume.slice(0, 12)}…`}</Hint> : null}
        {body}
      </FolderTabs>

      {ops.fundingPreview ? (
        <Review
          title={loc.privacy.review_funding}
          preview={ops.fundingPreview}
          unit={unit}
          busy={busy}
          onPublish={ops.publishFunding}
          onCancel={() => ops.setFundingPreview(null)}
        />
      ) : null}
      {ops.preview ? (
        <Review
          title={`${loc.privacy.review} · ${actionLabel(ops.action)}`}
          preview={ops.preview}
          unit={unit}
          busy={busy}
          onPublish={ops.publishXna}
          onCancel={() => ops.setPreview(null)}
        />
      ) : null}
      {sponsor.prepared ? (
        <Review
          title={`${loc.privacy.review} · ${actionLabel(ops.action)}`}
          preview={{ raw: '', txid: sponsor.prepared.txid, points: [], fee: formatXna(ops.fee || '0') }}
          unit={unit}
          busy={busy}
          onPublish={sponsor.publish}
          onCancel={() => sponsor.setPrepared(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  recipient: { rowGap: 8 },
  review: { marginTop: 14 },
  reviewTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  reviewButtons: { flexDirection: 'row', columnGap: 10, marginTop: 14 },
});
