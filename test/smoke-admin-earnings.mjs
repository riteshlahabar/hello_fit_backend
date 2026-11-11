/**
 * Smoke test for `/admin/earnings` (PDF 6.8), against the real server and
 * database.
 *
 * Read-only. Withhold and release change whether a real instructor gets paid
 * in the next batch, so neither is driven here — `smoke:payout` already covers
 * them against its own seeded fixture.
 *
 * What this proves is the screen's query: the joins 6.8 needs (booking,
 * service, instructor) and — the reason the repository was changed — that the
 * **payout's status** rides along, not just its id.
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

await withTemporaryAdmin(async (fx) => {
  const login = await fetch(`${BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx.email, password: fx.password }),
  }).then((r) => r.json());
  token = login?.data?.accessToken ?? '';
  check('admin token', token.length > 20, true);

  const list = await call('/admin/earnings?limit=20');
  check('rows is an array', Array.isArray(list?.data), true);
  check('meta has a page', typeof list?.meta?.page, 'number');

  const rows = list?.data ?? [];
  const first = rows[0];
  if (first) {
    // The four things 6.8 asks to display.
    check('booking value present', 'sessionValue' in first, true);
    check('commission present', 'commissionAmount' in first, true);
    check('deductions present', 'deductions' in first, true);
    check('net present', 'netAmount' in first, true);
    check('instructor joined in', typeof first?.instructor?.name, 'string');
    check('booking code joined in', typeof first?.session?.booking?.code, 'string');
    check('service joined in', typeof first?.session?.service?.name, 'string');

    // The repository change: a batched earning carries the batch's status.
    const batched = rows.find((r) => r.payoutItem);
    if (batched) {
      check('payout status rides along', typeof batched.payoutItem?.payout?.status, 'string');
      check('payout cycle rides along', 'cycleFrom' in (batched.payoutItem?.payout ?? {}), true);
    } else {
      console.log('note: no batched earnings in this database');
    }

    await call(`/admin/earnings?instructorId=${first.instructor.id}&limit=1`);
  } else {
    console.log('note: no earnings in this database');
  }

  for (const s of ['PENDING', 'PAYABLE', 'PAID', 'WITHHELD']) {
    await call(`/admin/earnings?status=${s}&limit=1`);
  }

  // Session-date range, not created-date: finance reconciles by when the work
  // happened.
  await call('/admin/earnings?from=2026-01-01&to=2026-12-31&limit=1');

  // Rejected by the DTO rather than ignored.
  await call('/admin/earnings?status=NOPE', 400);
  await call('/admin/earnings?instructorId=not-a-uuid', 400);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
