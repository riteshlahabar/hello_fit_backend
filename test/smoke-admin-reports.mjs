/**
 * Smoke test for `/admin/reports/*` (PDF 6.12), against the real server and
 * database. Read-only — it creates nothing, so there is nothing to clean up.
 *
 * On `smoke-harness.mjs`, so this file is assertions and nothing else.
 *
 * The assertions that earn it:
 *
 * - **The range is inclusive at both ends.** A single-day range must report
 *   `days: 1`, and a 7-day range `days: 7`. This is the off-by-one-day bug in
 *   `state/gotchas.md`, and a report is exactly where it hides.
 * - **The range moves the numbers.** A window in 2000 is empty while the
 *   platform totals stay put — the proof that the `where` clauses are wired
 *   to the window and not ignored.
 * - **The rows cover every day, gaps included.** A quiet day must be a zero
 *   row, not a missing one.
 * - **Totals agree with the rows.** They come from a separate `aggregate`, so
 *   this is a real cross-check, not a tautology.
 * - **A green build does not prove a Prisma query runs** — all four routes
 *   are actually requested, including the raw-free day bucketing.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
const today = s.day();

await s.withAdmin(async () => {
  s.section('defaults');

  // No range → the last 30 days ending today.
  const def = await s.call('GET', '/admin/reports/bookings');
  s.check('defaults to 30 days', def?.data?.range?.days, 30);
  s.check('default range ends today', def?.data?.range?.to, today);
  s.check('one row per day', def?.data?.rows?.length, 30);

  s.section('range is inclusive at both ends');

  const oneDay = await s.call(
    'GET',
    `/admin/reports/bookings?from=${today}&to=${today}`,
  );
  s.check('a single day is 1 day, not 0', oneDay?.data?.range?.days, 1);
  s.check('and yields exactly one row', oneDay?.data?.rows?.length, 1);
  s.check('whose date is that day', oneDay?.data?.rows?.[0]?.date, today);
  s.check('echoed from unshifted', oneDay?.data?.range?.from, today);
  s.check('echoed to unshifted', oneDay?.data?.range?.to, today);

  const week = await s.call(
    'GET',
    `/admin/reports/bookings?from=${s.day(-6)}&to=${today}`,
  );
  s.check('a 7-day range is 7 days', week?.data?.range?.days, 7);
  s.check('with 7 rows, gaps included', week?.data?.rows?.length, 7);

  s.section('bookings report');

  const rows = week?.data?.rows ?? [];
  s.check('every row has a numeric booking count', rows.every((r) => typeof r.bookings === 'number'), true);
  s.check('every row nets gross minus discount', rows.every((r) => Math.abs(r.net - (r.gross - r.discount)) < 0.01), true);
  s.check(
    'row bookings sum to the range total',
    rows.reduce((sum, r) => sum + r.bookings, 0),
    week?.data?.totals?.bookings,
  );
  s.check(
    'row sessions sum to the range total',
    rows.reduce((sum, r) => sum + r.sessions, 0),
    week?.data?.totals?.sessions,
  );
  s.check('totals net is gross minus discount', Math.abs((week?.data?.totals?.net ?? 0) - ((week?.data?.totals?.gross ?? 0) - (week?.data?.totals?.discount ?? 0))) < 0.01, true);

  s.section('customers and providers');

  const accounts = await s.call('GET', '/admin/reports/customers-providers');
  const c = accounts?.data?.customers ?? {};
  const p = accounts?.data?.providers ?? {};
  s.check('customer total is a number', typeof c.total, 'number');
  s.check('new-in-range never exceeds the total', c.newInRange <= c.total, true);
  s.check('active never exceeds the total', c.active <= c.total, true);
  s.check('provider total is a number', typeof p.total, 'number');
  s.check('pending applications never exceed the total', p.pendingApplications <= p.total, true);
  s.check('kyc pending is a number', typeof p.kycPending, 'number');

  s.section('payments');

  const payments = await s.call('GET', '/admin/reports/payments');
  const prows = payments?.data?.rows ?? [];
  s.check('rows is an array', Array.isArray(prows), true);
  s.check('every row has a count and an amount', prows.every((r) => typeof r.count === 'number' && typeof r.amount === 'number'), true);
  s.check(
    'counts sum to the total',
    prows.reduce((sum, r) => sum + r.count, 0),
    payments?.data?.totals?.count,
  );
  s.check('refunds are their own line', typeof payments?.data?.refunds?.count, 'number');

  s.section('booking status totals');

  const status = await s.call('GET', '/admin/reports/booking-status');
  const srows = status?.data?.rows ?? [];
  s.check('all thirteen statuses are listed', srows.length, 13);
  s.check('cancellations are not rolled up', srows.filter((r) => r.status.startsWith('CANCELLED_BY_')).length, 3);
  s.check('no-shows are not rolled up', srows.filter((r) => r.status.startsWith('NO_SHOW_')).length, 2);
  s.check(
    'session counts sum to the total',
    srows.reduce((sum, r) => sum + r.sessions, 0),
    status?.data?.total,
  );
  s.check('every percent is a number, never NaN', srows.every((r) => Number.isFinite(r.percent)), true);

  s.section('the window actually moves');

  // A range entirely in 2000: every range-scoped figure must be zero, while
  // the platform totals are unchanged.
  const old = await s.call(
    'GET',
    '/admin/reports/bookings?from=2000-01-01&to=2000-01-07',
  );
  s.check('no bookings in 2000', old?.data?.totals?.bookings, 0);
  s.check('no sessions in 2000', old?.data?.totals?.sessions, 0);
  s.check('still 7 zero rows', old?.data?.rows?.length, 7);

  const oldAccounts = await s.call(
    'GET',
    '/admin/reports/customers-providers?from=2000-01-01&to=2000-01-07',
  );
  s.check('nobody joined in 2000', oldAccounts?.data?.customers?.newInRange, 0);
  s.check(
    'but the customer total is window-independent',
    oldAccounts?.data?.customers?.total,
    c.total,
  );

  const oldStatus = await s.call(
    'GET',
    '/admin/reports/booking-status?from=2000-01-01&to=2000-01-07',
  );
  s.check('no sessions scheduled in 2000', oldStatus?.data?.total, 0);
  s.check('an empty range still lists thirteen', oldStatus?.data?.rows?.length, 13);
  s.check('and reports 0%, not NaN', oldStatus?.data?.rows?.[0]?.percent, 0);

  s.section('rejections');

  // Reversed range, refused by the service with a named end.
  const reversed = await s.call(
    'GET',
    `/admin/reports/bookings?from=${today}&to=${s.day(-5)}`,
    undefined,
    400,
  );
  s.check('reversed range is a validation failure', s.errorCode(reversed), 'VALIDATION_FAILED');

  // Over the 366-day ceiling.
  await s.call(
    'GET',
    '/admin/reports/bookings?from=2020-01-01&to=2026-01-01',
    undefined,
    400,
  );

  // Rejected by the DTO rather than ignored.
  await s.call('GET', '/admin/reports/bookings?from=not-a-date', undefined, 400);
  await s.call('GET', '/admin/reports/bookings?to=2026-13-45', undefined, 400);

  // Every route shares the range, so every route rejects a bad one.
  for (const report of ['customers-providers', 'payments', 'booking-status']) {
    await s.call(`GET`, `/admin/reports/${report}?from=nope`, undefined, 400);
  }
});

s.section('unauthenticated');

for (const report of [
  'customers-providers',
  'bookings',
  'payments',
  'booking-status',
]) {
  await s.noToken('GET', `/admin/reports/${report}`);
}

s.done();
