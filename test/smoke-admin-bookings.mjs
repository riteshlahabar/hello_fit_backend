/**
 * Smoke test for `/admin/bookings/*` (PDF 6.6), against the real server and
 * database. A green build does not prove a Prisma query — this drives one.
 *
 * Read-only by design: it exercises list, every filter, and detail. It does
 * **not** call cancel, because that would destroy real dev bookings; the
 * cancel path's guard (everything already terminal → 409) is the one branch
 * left for a manual check.
 *
 *   npm run build && node -r dotenv/config dist/main.js &
 *   npm run smoke:admin-bookings
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

  // The list, with its joins — customer -> user, service, sessions ->
  // instructor. This is the query a bad `where` or `select` would throw on.
  const list = await call('/admin/bookings?limit=5');
  check('rows is an array', Array.isArray(list?.data), true);
  check('meta has a page', typeof list?.meta?.page, 'number');

  // Every filter, because each builds a different `where`.
  for (const s of ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED_BY_ADMIN']) {
    await call(`/admin/bookings?status=${s}&limit=1`);
  }
  for (const p of ['UNPAID', 'PAID', 'REFUNDED', 'FAILED']) {
    await call(`/admin/bookings?paymentStatus=${p}&limit=1`);
  }
  await call('/admin/bookings?q=HF&limit=1');

  // Rejected by the DTO rather than ignored.
  await call('/admin/bookings?status=NOT_A_STATUS', 400);

  const first = list?.data?.[0];
  if (first) {
    const detail = await call(`/admin/bookings/${first.id}`);
    check('detail has sessions', Array.isArray(detail?.data?.sessions), true);
    check('detail has statusHistory', Array.isArray(detail?.data?.statusHistory), true);
    check('detail has payments', Array.isArray(detail?.data?.payments), true);
    check('detail joins the customer', typeof detail?.data?.customer?.name, 'string');
  } else {
    console.log('note: no bookings in this database — detail not exercised');
  }

  // A missing booking is a 404, not a 500.
  await call('/admin/bookings/00000000-0000-4000-8000-000000000000', 404);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
