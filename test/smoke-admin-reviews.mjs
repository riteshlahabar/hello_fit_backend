/**
 * Smoke test for the admin review routes (PDF 6.10), against the real server
 * and database.
 *
 * Read-only. Approve and hide change a real review's visibility on
 * customer-facing platforms, so they are not driven here.
 *
 * **The direction assertions were inverted on 10 Nov 2026.** This file used to
 * prove that the instructor-to-customer review never appeared; the client then
 * asked for both directions as two admin screens, the internal one included.
 * What it proves now is that `direction` filters cleanly in both directions
 * and that the confidential note rides only on the internal one — an admin
 * route may serve it, a customer-facing route never may.
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

  const list = await call('/admin/reviews?limit=20');
  check('rows is an array', Array.isArray(list?.data), true);
  check('meta has a page', typeof list?.meta?.page, 'number');

  const rows = list?.data ?? [];
  if (rows[0]) {
    check('direction is on every row', 'direction' in rows[0], true);
    check('customer name resolved', 'customerName' in rows[0], true);
    check('instructor name resolved', 'instructorName' in rows[0], true);
    check('booking joined in', typeof rows[0]?.booking?.code, 'string');
    check('open reports included', Array.isArray(rows[0]?.reports), true);
  } else {
    console.log('note: no reviews in this database');
  }

  // The two admin screens are this filter, and nothing else.
  const outbound = await call('/admin/reviews?direction=CUSTOMER_TO_INSTRUCTOR&limit=20');
  check(
    'customer screen returns only that direction',
    (outbound?.data ?? []).every((r) => r.direction === 'CUSTOMER_TO_INSTRUCTOR'),
    true,
  );
  check(
    'a customer review never carries a private note',
    (outbound?.data ?? []).some((r) => r.confidentialNote),
    false,
  );

  const inbound = await call('/admin/reviews?direction=INSTRUCTOR_TO_CUSTOMER&limit=20');
  check(
    'instructor screen returns only that direction',
    (inbound?.data ?? []).every((r) => r.direction === 'INSTRUCTOR_TO_CUSTOMER'),
    true,
  );

  // Both sides resolve whichever way round author and subject sit. Checked as
  // "looked up", not "non-empty": a customer who signed up by OTP and never
  // completed their profile has a blank name, and that is a real row.
  for (const r of [...(outbound?.data ?? []), ...(inbound?.data ?? [])].slice(0, 6)) {
    check(
      `${r.direction} resolves both sides`,
      typeof r.customerName === 'string' && typeof r.instructorName === 'string',
      true,
    );
  }

  await call('/admin/reviews?direction=SIDEWAYS', 400);

  for (const s of ['SUBMITTED', 'PUBLISHED', 'FLAGGED', 'HIDDEN']) {
    await call(`/admin/reviews?state=${s}&limit=1`);
  }
  for (const n of [1, 3, 5]) {
    await call(`/admin/reviews?rating=${n}&limit=1`);
  }

  // Rejected by the DTO rather than ignored.
  await call('/admin/reviews?state=NOPE', 400);
  await call('/admin/reviews?rating=9', 400);

  // The pre-existing queue route still answers.
  const queue = await call('/admin/reviews/moderation-queue');
  check('queue is an array', Array.isArray(queue?.data), true);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
