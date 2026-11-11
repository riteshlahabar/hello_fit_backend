/**
 * Smoke test for `/admin/dashboard/summary` (PDF 6.2), against the real server
 * and database. One GET, so this is read-only.
 *
 * The assertions that earn this file: the counts come back as numbers rather
 * than Prisma group rows, the day window actually moves (a date far in the
 * past has no bookings, sessions or payments), and `date` echoes the calendar
 * day asked for — the off-by-one-day bug in `state/gotchas.md` is exactly what
 * a dashboard would hide.
 */
import { withTemporaryAdmin } from './admin-fixture.mjs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1';
let token = '';
let pass = 0;
let fail = 0;

async function call(path, expect = 200) {
  const res = await fetch(BASE + path, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  ok ? (pass += 1) : (fail += 1);
  if (!ok) {
    console.log(`FAIL  GET ${path} -> ${res.status} (wanted ${expect})`);
    console.log(`      ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? (pass += 1) : (fail += 1);
  if (!ok) console.log(`FAIL  ${label}: ${JSON.stringify(actual)} (wanted ${JSON.stringify(expected)})`);
}

const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

await withTemporaryAdmin(async (fx) => {
  const login = await fetch(`${BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx.email, password: fx.password }),
  }).then((r) => r.json());
  token = login?.data?.accessToken ?? '';
  check('admin token', token.length > 20, true);

  // No date → today, in institute-local terms.
  const now = await call('/admin/dashboard/summary');
  const d = now?.data ?? {};
  check('defaults to today', d.date, todayStr);

  check('customer total is a number', typeof d.customers?.total, 'number');
  check('customer active is a number', typeof d.customers?.active, 'number');
  check('customer suspended is a number', typeof d.customers?.suspended, 'number');
  check('customer blocked is a number', typeof d.customers?.blocked, 'number');

  check('instructor total is a number', typeof d.instructors?.total, 'number');
  check('instructor active is a number', typeof d.instructors?.active, 'number');
  check('pending applications is a number', typeof d.instructors?.pendingApplications, 'number');
  check('kyc pending is a number', typeof d.instructors?.kycPending, 'number');
  check(
    'pending applications never exceed the instructor total',
    d.instructors?.pendingApplications <= d.instructors?.total,
    true,
  );

  check('booking total is a number', typeof d.bookings?.total, 'number');
  for (const s of ['UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED']) {
    check(`payment status ${s} is tiled`, typeof d.bookings?.byPaymentStatus?.[s], 'number');
  }
  check(
    'booking total equals the payment-status breakdown',
    Object.values(d.bookings?.byPaymentStatus ?? {}).reduce((a, b) => a + b, 0),
    d.bookings?.total,
  );

  // Main statuses only — thirteen SessionStatus members, six tiles.
  const byStatus = d.sessions?.byStatus ?? {};
  check('six status tiles', Object.keys(byStatus).length, 6);
  for (const k of ['confirmed', 'assigned', 'inProgress', 'completed', 'cancelled', 'noShow']) {
    check(`session tile ${k} is a number`, typeof byStatus[k], 'number');
  }
  check(
    'tiled sessions never exceed the day total',
    Object.values(byStatus).reduce((a, b) => a + b, 0) <= d.sessions?.total,
    true,
  );

  for (const s of ['CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED']) {
    check(`payment state ${s} has a count`, typeof d.payments?.[s]?.count, 'number');
    check(`payment state ${s} has an amount`, 'amount' in (d.payments?.[s] ?? {}), true);
  }

  // The selector moves the window: totals stay, the day's counts go to zero.
  const old = await call('/admin/dashboard/summary?date=2000-01-01');
  const o = old?.data ?? {};
  check('date echoes back unshifted', o.date, '2000-01-01');
  check('no bookings in 2000', o.bookings?.total, 0);
  check('no sessions in 2000', o.sessions?.total, 0);
  check('no payments in 2000', o.payments?.CAPTURED?.count, 0);
  check('customer total is window-independent', o.customers?.total, d.customers?.total);
  check('instructor total is window-independent', o.instructors?.total, d.instructors?.total);

  // Rejected by the DTO rather than ignored.
  await call('/admin/dashboard/summary?date=not-a-date', 400);
  await call('/admin/dashboard/summary?date=2026-13-45', 400);
});

// Unauthenticated is rejected by the global JwtAuthGuard.
token = '';
await call('/admin/dashboard/summary', 401);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
