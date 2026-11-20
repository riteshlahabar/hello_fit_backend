import { formatDate, formatDateTime } from '../../common/dates/format';
import { money, shortNameOf } from './trainer-view';

/** The four chips across the top of page 57. */
export type EarningsPeriod = 'week' | 'month' | 'quarter' | 'year';

/**
 * The window a chip covers, plus where the one before it starts — page 57
 * prints "↑ 12.5% compared to last month", so every period needs its
 * predecessor.
 *
 * Half-open: `[from, to)`. All UTC, because `Earning.createdAt` is a
 * `timestamptz` and the comparison must not drift with the server's zone.
 */
export function periodWindow(period: EarningsPeriod): {
  from: Date;
  to: Date;
  previousFrom: Date;
} {
  const to = new Date();
  const from = new Date(to);
  const previousFrom = new Date(to);

  switch (period) {
    case 'week':
      from.setUTCDate(from.getUTCDate() - 7);
      previousFrom.setUTCDate(previousFrom.getUTCDate() - 14);
      break;
    case 'quarter':
      from.setUTCMonth(from.getUTCMonth() - 3);
      previousFrom.setUTCMonth(previousFrom.getUTCMonth() - 6);
      break;
    case 'year':
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      previousFrom.setUTCFullYear(previousFrom.getUTCFullYear() - 2);
      break;
    default:
      from.setUTCMonth(from.getUTCMonth() - 1);
      previousFrom.setUTCMonth(previousFrom.getUTCMonth() - 2);
  }

  return { from, to, previousFrom };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The bar chart. Buckets are built first and then filled, so a month with no
 * earnings is a zero bar rather than a missing one — the chart has to keep
 * six evenly spaced columns.
 */
export function monthSeries(
  rows: Array<{ netAmount: unknown; createdAt: Date }>,
  months: number,
): Array<{ key: string; label: string; amount: number }> {
  const buckets = new Map<string, { key: string; label: string; amount: number }>();
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() - (months - 1));

  for (let i = 0; i < months; i += 1) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, { key, label: MONTHS[cursor.getUTCMonth()], amount: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (const row of rows) {
    const key = `${row.createdAt.getUTCFullYear()}-${String(row.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.amount += money(row.netAmount);
  }

  return [...buckets.values()].map((b) => ({ ...b, amount: Math.round(b.amount) }));
}

export interface Transaction {
  id: string;
  kind: 'EARNING' | 'PAYOUT';
  /** Signed: an earning adds to the balance, a payout takes it away. */
  direction: 'IN' | 'OUT';
  title: string;
  subtitle: string;
  status: string;
  amount: number;
  on: string;
  at: string;
}

/** Merges the two rails into the one list pages 57 and 58 show. */
export function toTransactions(
  earnings: Array<{
    id: string;
    netAmount: unknown;
    status: string;
    createdAt: Date;
    session: {
      sessionDate: Date;
      service: { name: string };
      booking: { customer: { name: string } };
    };
  }>,
  payouts: Array<{
    id: string;
    net: unknown;
    status: string;
    createdAt: Date;
    paidAt: Date | null;
    utr: string | null;
  }>,
): Transaction[] {
  const rows: Array<Transaction & { sort: number }> = [
    ...earnings.map((row) => ({
      id: row.id,
      kind: 'EARNING' as const,
      direction: 'IN' as const,
      title: `Session · ${shortNameOf(row.session.booking.customer.name)}`,
      subtitle: row.session.service.name,
      status: row.status,
      amount: money(row.netAmount),
      on: formatDate(row.session.sessionDate),
      at: formatDateTime(row.createdAt),
      sort: row.createdAt.getTime(),
    })),
    ...payouts.map((row) => ({
      id: row.id,
      kind: 'PAYOUT' as const,
      direction: 'OUT' as const,
      title: 'Payout · Bank transfer',
      subtitle: row.utr ? `UTR ${row.utr}` : 'Awaiting transfer',
      status: row.status,
      amount: money(row.net),
      on: formatDate(row.paidAt ?? row.createdAt),
      at: formatDateTime(row.paidAt ?? row.createdAt),
      sort: (row.paidAt ?? row.createdAt).getTime(),
    })),
  ];

  return rows
    .sort((a, b) => b.sort - a.sort)
    .slice(0, 25)
    .map(({ sort: _sort, ...row }) => row);
}
