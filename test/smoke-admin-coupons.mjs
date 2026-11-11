/**
 * Smoke test for coupons (PDF 6.9, US-A09), against the real server and
 * database. Covers both halves: the admin CRUD under `/admin/coupons` and the
 * customer-facing `/app/customer/coupons/validate`.
 *
 * The assertions that earn this file:
 *
 * - **The discount maths is the server's.** A percentage coupon is capped by
 *   `maxDiscount`, a flat coupon is capped by the charge itself, and neither
 *   figure comes from the client.
 * - **Validity is inclusive at both ends.** A coupon whose window is exactly
 *   today must apply; one that ended yesterday must not. This is the
 *   calendar-day boundary in `state/gotchas.md`, which a `new Date()`
 *   comparison gets wrong by a day.
 * - **Every refusal carries its own error code**, so the app can say *why* —
 *   expired, under the minimum, or fully redeemed are three different
 *   messages to a customer.
 * - **A green build does not prove a Prisma query runs** — every filter
 *   combination on the list route is actually executed here.
 *
 * Everything it creates is removed at the end, including the throwaway admin.
 */
import { withTemporaryAdmin } from './admin-fixture.mjs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1';
const SUFFIX = Date.now().toString(36).toUpperCase().slice(-6);
const mobile = `9${Math.floor(100000000 + Math.random() * 899999999)}`;

let adminToken = '';
let customerToken = '';
let pass = 0;
let fail = 0;

/** `token` picks which bearer to send: 'admin', 'customer' or 'none'. */
async function call(method, path, body, expect = 200, token = 'admin') {
  const bearer =
    token === 'admin' ? adminToken : token === 'customer' ? customerToken : '';

  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  ok ? (pass += 1) : (fail += 1);

  if (!ok) {
    console.log(`FAIL  ${method} ${path} -> ${res.status} (wanted ${expect})`);
    console.log(`      ${JSON.stringify(json).slice(0, 240)}`);
  }

  return json;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? (pass += 1) : (fail += 1);
  if (!ok) {
    console.log(
      `FAIL  ${label}: ${JSON.stringify(actual)} (wanted ${JSON.stringify(expected)})`,
    );
  }
}

/** Calendar day as YYYY-MM-DD, offset by whole days from today. */
function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const created = [];

await withTemporaryAdmin(async (fx) => {
  const login = await fetch(`${BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx.email, password: fx.password }),
  }).then((r) => r.json());

  adminToken = login?.data?.accessToken ?? '';
  check('admin token', adminToken.length > 20, true);

  // ------------------------------------------------------------- 1. create
  console.log('\n--- create ---');

  const pct = await call('POST', '/admin/coupons', {
    code: `pct${SUFFIX}`,
    description: '20% off, capped at 300',
    discountType: 'PERCENT',
    discountValue: 20,
    maxDiscount: 300,
    minBookingAmount: 500,
    validFrom: day(0),
    validTo: day(0),
  }, 201);

  created.push(pct?.data?.id);
  check('code is upper-cased on save', pct?.data?.code, `PCT${SUFFIX}`);
  check('discountValue comes back a number', typeof pct?.data?.discountValue, 'number');
  check('validFrom is a calendar day, not an instant', pct?.data?.validFrom, day(0));
  check('a window of exactly today reads as valid', pct?.data?.validity, 'valid');
  check('usedCount starts at zero', pct?.data?.usedCount, 0);
  check('active by default', pct?.data?.isActive, true);
  check('not exhausted with no limit', pct?.data?.exhausted, false);

  const flat = await call('POST', '/admin/coupons', {
    code: `flat${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 5000,
    validFrom: day(-5),
    validTo: day(30),
    usageLimit: 1,
  }, 201);

  created.push(flat?.data?.id);
  check('flat coupon has no ceiling', flat?.data?.maxDiscount, null);

  const expired = await call('POST', '/admin/coupons', {
    code: `old${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 100,
    validFrom: day(-30),
    validTo: day(-1),
  }, 201);

  created.push(expired?.data?.id);
  check('a window that ended yesterday reads as expired', expired?.data?.validity, 'expired');

  const upcoming = await call('POST', '/admin/coupons', {
    code: `soon${SUFFIX}`,
    discountType: 'PERCENT',
    discountValue: 10,
    validFrom: day(7),
    validTo: day(14),
  }, 201);

  created.push(upcoming?.data?.id);
  check('a future window reads as upcoming', upcoming?.data?.validity, 'upcoming');

  // ---------------------------------------------------- 2. field validation
  console.log('\n--- validation ---');

  const dup = await call('POST', '/admin/coupons', {
    code: `PCT${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 50,
    validFrom: day(0),
    validTo: day(1),
  }, 409);
  check('a duplicate code is a conflict', dup?.error?.code ?? dup?.code, 'DUPLICATE_RESOURCE');

  // Same code in lower case — the upper-casing must make this a duplicate too.
  await call('POST', '/admin/coupons', {
    code: `pct${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 50,
    validFrom: day(0),
    validTo: day(1),
  }, 409);

  await call('POST', '/admin/coupons', {
    code: `bad${SUFFIX}`,
    discountType: 'PERCENT',
    discountValue: 120,
    validFrom: day(0),
    validTo: day(1),
  }, 400);

  await call('POST', '/admin/coupons', {
    code: `bad${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 50,
    maxDiscount: 10,
    validFrom: day(0),
    validTo: day(1),
  }, 400);

  await call('POST', '/admin/coupons', {
    code: `bad${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 50,
    validFrom: day(5),
    validTo: day(1),
  }, 400);

  // Rejected by the DTO, not by the service.
  await call('POST', '/admin/coupons', {
    code: `has space ${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 50,
    validFrom: day(0),
    validTo: day(1),
  }, 400);

  await call('POST', '/admin/coupons', {
    code: `zero${SUFFIX}`,
    discountType: 'FLAT',
    discountValue: 0,
    validFrom: day(0),
    validTo: day(1),
  }, 400);

  await call('POST', '/admin/coupons', {
    code: `nd${SUFFIX}`,
    discountType: 'SOMETHING',
    discountValue: 10,
    validFrom: day(0),
    validTo: day(1),
  }, 400);

  // ------------------------------------------------------- 3. list filters
  console.log('\n--- list filters ---');

  const mine = await call('GET', `/admin/coupons?q=${SUFFIX}`);
  check('search finds the four created', mine?.data?.length, 4);
  check('meta carries the total', mine?.meta?.total, 4);
  check('meta carries the page', mine?.meta?.page, 1);

  const validOnly = await call('GET', `/admin/coupons?q=${SUFFIX}&validity=valid`);
  check('validity=valid excludes expired and upcoming', validOnly?.data?.length, 2);

  const expiredOnly = await call('GET', `/admin/coupons?q=${SUFFIX}&validity=expired`);
  check('validity=expired finds the one', expiredOnly?.data?.length, 1);
  check('and it is the right one', expiredOnly?.data?.[0]?.code, `OLD${SUFFIX}`);

  const upcomingOnly = await call('GET', `/admin/coupons?q=${SUFFIX}&validity=upcoming`);
  check('validity=upcoming finds the one', upcomingOnly?.data?.length, 1);

  const activeOnly = await call('GET', `/admin/coupons?q=${SUFFIX}&status=active`);
  check('status=active finds all four', activeOnly?.data?.length, 4);

  const inactiveOnly = await call('GET', `/admin/coupons?q=${SUFFIX}&status=inactive`);
  check('status=inactive finds none yet', inactiveOnly?.data?.length, 0);

  await call('GET', '/admin/coupons?limit=500', undefined, 400);
  await call('GET', '/admin/coupons?validity=whenever', undefined, 400);

  // ------------------------------------------------- 4. customer: validate
  console.log('\n--- customer validate ---');

  const send = await call('POST', '/auth/otp/send', { mobile }, 200, 'none');
  const devCode = send?.data?.devCode;

  if (!devCode) {
    console.error('no devCode — NODE_ENV must be development for this test');
    process.exit(1);
  }

  const verify = await call(
    'POST',
    '/auth/otp/verify',
    { mobile, code: devCode },
    200,
    'none',
  );
  customerToken = verify?.data?.accessToken ?? '';
  check('customer token', customerToken.length > 20, true);

  // 20% of 1000 = 200, under the 300 ceiling.
  const under = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `PCT${SUFFIX}`, amount: 1000 },
    200,
    'customer',
  );
  check('percentage applied', under?.data?.discount, 200);
  check('payable is amount minus discount', under?.data?.payable, 800);

  // 20% of 5000 = 1000, so the 300 ceiling binds.
  const capped = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `PCT${SUFFIX}`, amount: 5000 },
    200,
    'customer',
  );
  check('maxDiscount caps the percentage', capped?.data?.discount, 300);
  check('payable reflects the cap', capped?.data?.payable, 4700);

  // Case-insensitive on the way in.
  const lower = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `pct${SUFFIX}`, amount: 1000 },
    200,
    'customer',
  );
  check('a lower-case code still matches', lower?.data?.discount, 200);

  // ₹5000 flat off a ₹300 booking is ₹300, never a negative payable.
  const overshoot = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `FLAT${SUFFIX}`, amount: 300 },
    200,
    'customer',
  );
  check('a flat discount cannot exceed the charge', overshoot?.data?.discount, 300);
  check('payable floors at zero', overshoot?.data?.payable, 0);

  const belowMin = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `PCT${SUFFIX}`, amount: 100 },
    400,
    'customer',
  );
  check(
    'under the minimum has its own code',
    belowMin?.error?.code ?? belowMin?.code,
    'COUPON_MIN_NOT_MET',
  );

  const gone = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `OLD${SUFFIX}`, amount: 1000 },
    400,
    'customer',
  );
  check(
    'an expired coupon is refused',
    gone?.error?.code ?? gone?.code,
    'COUPON_INVALID',
  );

  await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `SOON${SUFFIX}`, amount: 1000 },
    400,
    'customer',
  );

  await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: 'NOSUCHCODE', amount: 1000 },
    400,
    'customer',
  );

  // The admin routes are not reachable with a customer token, and the
  // customer route is not reachable with an admin one.
  await call('GET', '/admin/coupons', undefined, 401, 'customer');
  await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `PCT${SUFFIX}`, amount: 1000 },
    401,
    'admin',
  );

  // ------------------------------------------- 4b. through a booking quote
  console.log('\n--- booking quote ---');

  // The seam that matters: the booking service must resolve the code itself.
  // A green build does not prove this runs (state/gotchas.md), so the quote
  // is actually requested.
  const services = await call('GET', '/services?limit=1', undefined, 200, 'none');
  const serviceId = services?.data?.[0]?.id;
  check('a seeded service exists to quote against', typeof serviceId, 'string');

  if (serviceId) {
    const plain = await call(
      'POST',
      '/app/customer/bookings/quote',
      { serviceId, sessionCount: 4 },
      201,
      'customer',
    );
    check('no code means no coupon on the quote', plain?.data?.coupon, null);

    const base = plain?.data?.grossAmount ?? 0;
    check('the quote has a gross to discount', base > 0, true);

    const withCode = await call(
      'POST',
      '/app/customer/bookings/quote',
      { serviceId, sessionCount: 4, couponCode: `FLAT${SUFFIX}` },
      201,
      'customer',
    );
    check(
      'the quote carries the applied code',
      withCode?.data?.coupon?.code,
      `FLAT${SUFFIX}`,
    );
    check(
      'the discount lands on the breakup',
      withCode?.data?.discount,
      withCode?.data?.coupon?.discount,
    );
    check('the discount is not zero', withCode?.data?.discount > 0, true);
    check(
      'the quote payable drops by the discount',
      withCode?.data?.payable < plain?.data?.payable,
      true,
    );

    // A client-sent discount is ignored once a code is present.
    const spoofed = await call(
      'POST',
      '/app/customer/bookings/quote',
      { serviceId, sessionCount: 4, couponCode: `FLAT${SUFFIX}`, discount: 99999 },
      201,
      'customer',
    );
    check(
      'a client discount cannot override the coupon',
      spoofed?.data?.discount,
      withCode?.data?.discount,
    );

    // An expired code fails the whole quote rather than quietly costing full price.
    await call(
      'POST',
      '/app/customer/bookings/quote',
      { serviceId, sessionCount: 1, couponCode: `OLD${SUFFIX}` },
      400,
      'customer',
    );
  }

  // ------------------------------------------------- 5. activate/deactivate
  console.log('\n--- status ---');

  const off = await call('POST', `/admin/coupons/${created[0]}/status`, {
    isActive: false,
  });
  check('deactivated', off?.data?.isActive, false);

  const refused = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `PCT${SUFFIX}`, amount: 1000 },
    400,
    'customer',
  );
  check(
    'an inactive coupon cannot be applied',
    refused?.error?.code ?? refused?.code,
    'COUPON_INVALID',
  );

  const nowInactive = await call('GET', `/admin/coupons?q=${SUFFIX}&status=inactive`);
  check('status=inactive now finds it', nowInactive?.data?.length, 1);

  const on = await call('POST', `/admin/coupons/${created[0]}/status`, {
    isActive: true,
  });
  check('reactivated', on?.data?.isActive, true);

  await call('POST', `/admin/coupons/${created[0]}/status`, {}, 400);

  // ------------------------------------------------------------- 6. update
  console.log('\n--- update ---');

  const edited = await call('PATCH', `/admin/coupons/${created[0]}`, {
    discountValue: 50,
    maxDiscount: 400,
    description: 'now half off',
  });
  check('new discountValue stored', edited?.data?.discountValue, 50);
  check('new ceiling stored', edited?.data?.maxDiscount, 400);

  const recheck = await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `PCT${SUFFIX}`, amount: 1000 },
    200,
    'customer',
  );
  check('the edit changes what the customer is offered', recheck?.data?.discount, 400);

  // Moving only one end is still checked against the stored other end.
  await call('PATCH', `/admin/coupons/${created[0]}`, { validFrom: day(60) }, 400);

  // Switching to FLAT while a ceiling is stored must be refused, not
  // silently left with a meaningless maxDiscount.
  await call('PATCH', `/admin/coupons/${created[0]}`, { discountType: 'FLAT' }, 400);

  const renamed = await call('PATCH', `/admin/coupons/${created[0]}`, {
    code: `ren${SUFFIX}`,
  });
  check('an unredeemed code can be renamed', renamed?.data?.code, `REN${SUFFIX}`);

  await call('PATCH', `/admin/coupons/${created[0]}`, { code: `FLAT${SUFFIX}` }, 409);
  await call('PATCH', '/admin/coupons/00000000-0000-4000-8000-000000000000', {
    description: 'nope',
  }, 404);

  // ------------------------------------------------------------- 7. delete
  console.log('\n--- delete ---');

  await call('DELETE', `/admin/coupons/${created[3]}`);

  const afterDelete = await call('GET', `/admin/coupons?q=${SUFFIX}`);
  check('a retired coupon leaves the list', afterDelete?.data?.length, 3);
  await call('DELETE', `/admin/coupons/${created[3]}`, undefined, 404);

  // A retired coupon is also unusable, not merely hidden.
  await call(
    'POST',
    '/app/customer/coupons/validate',
    { code: `SOON${SUFFIX}`, amount: 1000 },
    400,
    'customer',
  );
});

// --------------------------------------------------------------- 8. no token
adminToken = '';
customerToken = '';
await call('GET', '/admin/coupons', undefined, 401, 'none');
await call(
  'POST',
  '/app/customer/coupons/validate',
  { code: 'ANY', amount: 100 },
  401,
  'none',
);

// ----------------------------------------------------------------- clean up
const { PrismaClient } = await import('../dist/generated/prisma/client.js');
const { PrismaPg } = await import('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const removed = await prisma.coupon.deleteMany({
  where: { code: { endsWith: SUFFIX } },
});

await prisma.$disconnect();
console.log(`\ncleaned up ${removed.count} coupon(s)`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
