/**
 * End-to-end smoke test for `/admin/customers/*`, against the real server and
 * the real database.
 *
 * What it proves: ops can find a customer, read the file, correct the profile,
 * blacklist and un-blacklist, and suspend and reinstate the login — and that
 * the guard rails hold (blocking without a reason, and `DELETED` as a status).
 * A green `npm run build` does not prove any of it: an unknown field in a
 * Prisma `where` type-checks and then throws at runtime.
 *
 * It mints its own throwaway customer by OTP (so `NODE_ENV` must be
 * development for the `devCode`) and its own throwaway super-admin, and
 * removes both at the end.
 *
 * Run against a built server, not `start:dev` — the fixture imports the
 * generated Prisma client from `dist/`, which the watcher rebuilds underneath
 * it:
 *
 *   npm run build && node -r dotenv/config dist/main.js &
 *   npm run smoke:admin-customers
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { withTemporaryAdmin } from './admin-fixture.mjs';

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000/api/v1";
const mobile = '9' + String(Date.now()).slice(-9);

let adminToken = '';
let customerToken = '';
let pass = 0;
let fail = 0;

async function call(method, path, body, expect = 200, token = adminToken) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `${(ok ? 'PASS  ' : 'FAIL  ') + `${method} ${path}`.padEnd(58)} ${res.status}` +
      (ok ? '' : ` (wanted ${expect})  ${JSON.stringify(json).slice(0, 280)}`),
  );
  return json;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    ((ok ? 'PASS  ' : 'FAIL  ') + label).padEnd(64) +
      ` ${JSON.stringify(actual)}${ok ? '' : ` (wanted ${JSON.stringify(expected)})`}`,
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let userId = '';

try {
  // =========================================================================
  console.log('\n--- mint a throwaway customer by OTP ---');
  // =========================================================================
  const send = await call('POST', '/auth/otp/send', { mobile }, 200, '');
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
    '',
  );
  customerToken = verify?.data?.accessToken ?? '';
  userId = verify?.data?.user?.id ?? '';
  check('got a customer token', customerToken.length > 20, true);

  await call(
    'PATCH',
    '/app/customer/profile',
    { name: 'Smoke Customer', gender: 'FEMALE', goal: 'Flexibility' },
    200,
    customerToken,
  );

  await withTemporaryAdmin(async (fx) => {
    console.log('\n--- sign in as the throwaway super-admin ---');
    const login = await call(
      'POST',
      '/admin/auth/login',
      { email: fx.email, password: fx.password },
      200,
      '',
    );
    adminToken = login?.data?.accessToken ?? '';
    check('got an admin access token', adminToken.length > 20, true);

    // =======================================================================
    console.log('\n--- list: the search finds them by mobile ---');
    // =======================================================================
    const list = await call('GET', `/admin/customers?q=${mobile}`);
    check('exactly one match', list?.data?.length, 1);
    const row = list?.data?.[0] ?? {};
    const customerId = row.id ?? '';
    check('name came back', row.name, 'Smoke Customer');
    check('account mobile is joined in', row.user?.mobile, mobile);
    check('booking count is included', row._count?.bookings, 0);
    check('meta carries the page', list?.meta?.page, 1);

    // An app token on an /admin route is 401, not 403 — the audience guard
    // runs before the permission guard.
    await call('GET', '/admin/customers', null, 401, customerToken);

    // =======================================================================
    console.log('\n--- detail ---');
    // =======================================================================
    const detail = await call('GET', `/admin/customers/${customerId}`);
    check('addresses array present', Array.isArray(detail?.data?.addresses), true);
    check('wallet balance defaults to 0', Number(detail?.data?.wallet?.balance), 0);
    check('referral code is on the file', /^HF/.test(detail?.data?.referralCode ?? ''), true);

    // =======================================================================
    console.log('\n--- PATCH: ops corrects the profile ---');
    // =======================================================================
    const patched = await call('PATCH', `/admin/customers/${customerId}`, {
      name: 'Smoke Customer Edited',
      healthNotes: 'Left knee injury — no deep lunges.',
      dob: '1990-04-17',
    });
    check('name updated', patched?.data?.name, 'Smoke Customer Edited');
    check(
      'health notes updated',
      patched?.data?.healthNotes,
      'Left knee injury — no deep lunges.',
    );
    // A date of birth is a calendar day: it must come back as the day sent,
    // not shifted by a timezone.
    check('dob is the calendar day sent', String(patched?.data?.dob).slice(0, 10), '1990-04-17');

    // Derived fields are not editable — the DTO has no such property, and
    // forbidNonWhitelisted refuses the request outright.
    await call(
      'PATCH',
      `/admin/customers/${customerId}`,
      { trustScore: 99 },
      400,
    );

    // =======================================================================
    console.log('\n--- block: the blacklist, reason mandatory ---');
    // =======================================================================
    await call(
      'POST',
      `/admin/customers/${customerId}/block`,
      { isBlocked: true },
      400,
    );

    const blocked = await call('POST', `/admin/customers/${customerId}/block`, {
      isBlocked: true,
      reason: 'Repeated no-shows at the door.',
    });
    check('isBlocked set', blocked?.data?.isBlocked, true);
    check(
      'reason recorded',
      blocked?.data?.blockReason,
      'Repeated no-shows at the door.',
    );
    check('no sessions to worry about', blocked?.data?.upcomingSessions, 0);

    const blockedList = await call(
      'GET',
      `/admin/customers?q=${mobile}&isBlocked=true`,
    );
    check('the filter returns exactly that row', blockedList?.data?.length, 1);

    const unblocked = await call('POST', `/admin/customers/${customerId}/block`, {
      isBlocked: false,
    });
    check('block cleared', unblocked?.data?.isBlocked, false);
    check('reason cleared with it', unblocked?.data?.blockReason, null);

    // =======================================================================
    console.log('\n--- status: suspend ends the app session ---');
    // =======================================================================
    await call(
      'POST',
      `/admin/customers/${customerId}/status`,
      { status: 'DELETED', reason: 'Asked to be removed' },
      400,
    );

    const suspended = await call(
      'POST',
      `/admin/customers/${customerId}/status`,
      { status: 'SUSPENDED', reason: 'Payment dispute under investigation.' },
    );
    check('account suspended', suspended?.data?.user?.status, 'SUSPENDED');
    check('suspendedAt stamped', typeof suspended?.data?.user?.suspendedAt, 'string');
    check('the login was revoked', suspended?.data?.revokedSessions >= 1, true);

    const suspendedList = await call(
      'GET',
      `/admin/customers?q=${mobile}&status=SUSPENDED`,
    );
    check('the status filter returns that row', suspendedList?.data?.length, 1);

    const reinstated = await call(
      'POST',
      `/admin/customers/${customerId}/status`,
      { status: 'ACTIVE', reason: 'Dispute resolved in their favour.' },
    );
    check('account active again', reinstated?.data?.user?.status, 'ACTIVE');
    check('suspendedAt cleared', reinstated?.data?.user?.suspendedAt, null);
    check('suspendReason cleared', reinstated?.data?.user?.suspendReason, null);

    // =======================================================================
    console.log('\n--- the trail ---');
    // =======================================================================
    const audits = await prisma.auditLog.count({
      where: { adminUserId: fx.adminUserId },
    });
    // update + block + unblock + suspend + reinstate = 5.
    check('five admin actions were audited', audits, 5);
  });
} finally {
  if (userId) {
    await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.otpRequest.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user
      .delete({ where: { id: userId } })
      .catch((e) => console.error('customer cleanup failed:', e.message));
  }
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
