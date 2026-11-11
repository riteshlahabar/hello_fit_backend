/**
 * Smoke test for `/admin/payments/*` (PDF 6.7), against the real server and
 * database. Read-only by nature — every route is a GET.
 *
 * The assertion that earns this file: `rawPayload` must never be serialised.
 * It is the verbatim gateway response and can carry payer detail; 6.7's own
 * acceptance criteria forbid exposing payment credentials through the admin
 * interface.
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

  const list = await call('/admin/payments?limit=20');
  check('rows is an array', Array.isArray(list?.data), true);
  check('meta has a page', typeof list?.meta?.page, 'number');

  const rows = list?.data ?? [];
  check(
    'rawPayload is never serialised',
    JSON.stringify(rows).includes('rawPayload'),
    false,
  );
  check(
    'idempotencyKey is never serialised',
    JSON.stringify(rows).includes('idempotencyKey'),
    false,
  );

  const first = rows[0];
  if (first) {
    check('booking joined in', typeof first?.booking?.code, 'string');
    check('customer joined in', 'customer' in (first.booking ?? {}), true);
    // The provider comes off the first session, not the booking.
    check('session carries the provider', Array.isArray(first?.booking?.sessions), true);

    const detail = await call(`/admin/payments/${first.id}`);
    check('detail has refunds', Array.isArray(detail?.data?.refunds), true);
    check('detail has an invoice key', 'invoice' in (detail?.data ?? {}), true);
    check('detail hides rawPayload', JSON.stringify(detail?.data).includes('rawPayload'), false);

    // Search spans booking code, customer, provider and both gateway refs.
    await call(`/admin/payments?q=${first.booking?.code ?? 'HF'}&limit=1`);
    const byCustomer = first.booking?.customer?.name;
    if (byCustomer) await call(`/admin/payments?q=${encodeURIComponent(byCustomer)}&limit=1`);
    const byProvider = first.booking?.sessions?.[0]?.instructor?.name;
    if (byProvider) await call(`/admin/payments?q=${encodeURIComponent(byProvider)}&limit=1`);
    if (first.gatewayPaymentId) await call(`/admin/payments?q=${first.gatewayPaymentId}&limit=1`);
  } else {
    console.log('note: no payments in this database — detail not exercised');
  }

  for (const s of ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED']) {
    await call(`/admin/payments?status=${s}&limit=1`);
  }
  await call('/admin/payments?hasGatewayRef=true&limit=1');
  await call('/admin/payments?hasGatewayRef=false&limit=1');

  const summary = await call('/admin/payments/summary');
  check('summary is an array', Array.isArray(summary?.data), true);
  if (summary?.data?.[0]) {
    check('summary carries a count', typeof summary.data[0].count, 'number');
    check('summary carries a total', 'amount' in summary.data[0], true);
  }

  // Rejected by the DTO rather than ignored.
  await call('/admin/payments?status=NOPE', 400);
  await call('/admin/payments/not-a-uuid', 400);
  await call('/admin/payments/00000000-0000-4000-8000-000000000000', 404);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
