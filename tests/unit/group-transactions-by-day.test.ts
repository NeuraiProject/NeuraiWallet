import assert from 'assert';
import dayjs from 'dayjs';

import { groupTransactionsByDay } from '../../helpers/group-transactions-by-day';
import { Transaction } from '../../class/wallets/types';

const LABELS = { pending: 'Pending', today: 'Today', yesterday: 'Yesterday' };
const NOW = dayjs('2026-10-10T12:00:00');

const tx = (hash: string, iso: string, confirmations = 6): Transaction =>
  ({ hash, timestamp: dayjs(iso).unix(), confirmations, value: 1 }) as unknown as Transaction;

describe('groupTransactionsByDay', () => {
  it('returns nothing for no transactions', () => {
    assert.deepStrictEqual(groupTransactionsByDay([], LABELS, NOW), []);
  });

  it('groups by calendar day and labels today and yesterday', () => {
    const entries = groupTransactionsByDay(
      [
        tx('a', '2026-10-10T09:00:00'),
        tx('b', '2026-10-10T01:00:00'),
        tx('c', '2026-10-09T23:00:00'),
        tx('d', '2026-10-06T17:40:00'),
        tx('e', '2025-12-31T10:00:00'),
      ],
      LABELS,
      NOW,
    );
    const headers = entries.filter(e => e.kind === 'header').map(e => (e.kind === 'header' ? e.title : ''));
    assert.deepStrictEqual(headers, ['Today', 'Yesterday', 'Tuesday, 6 October', '31 December 2025']);
    assert.strictEqual(entries.length, 9);
  });

  it('marks the first and last transaction of each day', () => {
    const entries = groupTransactionsByDay(
      [tx('a', '2026-10-10T09:00:00'), tx('b', '2026-10-10T08:00:00'), tx('c', '2026-10-10T07:00:00'), tx('d', '2026-10-08T07:00:00')],
      LABELS,
      NOW,
    );
    const flags = entries.flatMap(e => (e.kind === 'transaction' ? [[e.tx.hash, e.isFirst, e.isLast]] : []));
    assert.deepStrictEqual(flags, [
      ['a', true, false],
      ['b', false, false],
      ['c', false, true],
      ['d', true, true],
    ]);
  });

  it('puts unconfirmed transactions in their own group on top', () => {
    const entries = groupTransactionsByDay([tx('a', '2026-10-10T09:00:00'), tx('p', '2026-10-09T09:00:00', 0)], LABELS, NOW);
    assert.deepStrictEqual(
      entries.map(e => e.key),
      ['h:pending', 't:p', 'h:2026-10-10', 't:a'],
    );
  });
});
