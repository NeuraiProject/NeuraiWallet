import dayjs from 'dayjs';

import { Transaction } from '../class/wallets/types';

/** A row of the wallet's transaction list: a day heading, or a transaction inside that day's card. */
export type TransactionListEntry =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'transaction'; key: string; tx: Transaction; isFirst: boolean; isLast: boolean };

export interface DayGroupLabels {
  pending: string;
  today: string;
  yesterday: string;
}

function dayTitle(day: dayjs.Dayjs, now: dayjs.Dayjs, labels: DayGroupLabels): string {
  if (day.isSame(now, 'day')) return labels.today;
  if (day.isSame(now.subtract(1, 'day'), 'day')) return labels.yesterday;
  return day.format(day.year() === now.year() ? 'dddd, D MMMM' : 'D MMMM YYYY');
}

/**
 * Splits newest-first transactions into day groups. Unconfirmed ones go to a
 * group of their own at the top whatever their timestamp, since "when" matters
 * less than "not settled yet". Each transaction knows whether it opens or
 * closes its group so the list can draw one rounded card per day.
 */
export function groupTransactionsByDay(txs: Transaction[], labels: DayGroupLabels, now: dayjs.Dayjs = dayjs()): TransactionListEntry[] {
  const groups: { key: string; title: string; txs: Transaction[] }[] = [];
  const byKey = new Map<string, Transaction[]>();

  const push = (key: string, title: string, tx: Transaction) => {
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = [];
      byKey.set(key, bucket);
      groups.push({ key, title, txs: bucket });
    }
    bucket.push(tx);
  };

  const pending = txs.filter(tx => !tx.confirmations);
  for (const tx of pending) push('pending', labels.pending, tx);

  for (const tx of txs) {
    if (!tx.confirmations) continue;
    const day = dayjs(tx.timestamp * 1000);
    push(day.format('YYYY-MM-DD'), dayTitle(day, now, labels), tx);
  }

  const entries: TransactionListEntry[] = [];
  for (const group of groups) {
    entries.push({ kind: 'header', key: `h:${group.key}`, title: group.title });
    group.txs.forEach((tx, i) => {
      entries.push({
        kind: 'transaction',
        key: `t:${tx.hash ?? `${group.key}:${i}`}`,
        tx,
        isFirst: i === 0,
        isLast: i === group.txs.length - 1,
      });
    });
  }
  return entries;
}
