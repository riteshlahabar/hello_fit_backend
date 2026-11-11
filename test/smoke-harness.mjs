/**
 * Shared harness for the `smoke-*.mjs` suites.
 *
 * Every suite had its own copy of the same six things: the base URL, a `call`
 * that counts a pass or a fail, a `check` that compares, the admin login, the
 * customer OTP login, and the tally-and-exit at the end. `smoke-admin-coupons`
 * was 547 lines and roughly 120 of them were that boilerplate.
 *
 * With this, a new menu's suite is its assertions and nothing else:
 *
 *     import { smoke } from './smoke-harness.mjs';
 *
 *     const s = smoke();
 *
 *     await s.withAdmin(async () => {
 *       const rows = await s.call('GET', '/admin/coupons');
 *       s.check('list answers', Array.isArray(rows?.data), true);
 *       await s.call('POST', '/admin/coupons', { code: '' }, 400);
 *     });
 *
 *     await s.noToken('GET', '/admin/coupons');
 *     await s.cleanup((db) => db.coupon.deleteMany({ where: { … } }));
 *     s.done();
 *
 * Two things it deliberately does **not** do: it never seeds domain rows (each
 * suite owns its own fixtures, because what a coupon suite needs is nothing
 * like what a payout suite needs), and it never swallows a failure — `done()`
 * exits non-zero so `npm run smoke:*` fails the shell.
 */
import { withTemporaryAdmin } from './admin-fixture.mjs';

export const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1';

/** Random Indian-format mobile, so repeat runs never collide on a user. */
export function randomMobile() {
  return `9${Math.floor(100000000 + Math.random() * 899999999)}`;
}

/** Calendar day as YYYY-MM-DD, offset by whole days from today. */
export function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${String(d.getDate()).padStart(2, '0')}`;
}

export function smoke() {
  const tokens = { admin: '', customer: '', instructor: '' };
  let pass = 0;
  let fail = 0;

  const bump = (ok) => {
    if (ok) pass += 1;
    else fail += 1;
    return ok;
  };

  /**
   * One request. `expect` is the status that counts as a pass — so the
   * rejections are assertions too, not try/catch noise. `who` picks the
   * bearer: 'admin' (default), 'customer', 'instructor' or 'none'.
   */
  async function call(method, path, body, expect = 200, who = 'admin') {
    const bearer = who === 'none' ? '' : (tokens[who] ?? '');

    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const json = await res.json().catch(() => ({}));

    if (!bump(res.status === expect)) {
      console.log(`FAIL  ${method} ${path} -> ${res.status} (wanted ${expect})`);
      console.log(`      ${JSON.stringify(json).slice(0, 240)}`);
    }

    return json;
  }

  /** Deep-equal on JSON, so an object or array expectation works unchanged. */
  function check(label, actual, expected) {
    if (!bump(JSON.stringify(actual) === JSON.stringify(expected))) {
      console.log(
        `FAIL  ${label}: ${JSON.stringify(actual)} (wanted ${JSON.stringify(expected)})`,
      );
    }
  }

  /** The error code off a rejection envelope, however it is shaped. */
  function errorCode(response) {
    return response?.error?.code ?? response?.code;
  }

  /** Section heading, so a failure is easy to place in the output. */
  function section(title) {
    console.log(`\n--- ${title} ---`);
  }

  /** Runs `body` with a throwaway super-admin logged in — `admin-fixture` makes
   * and removes the account, this adds the login every admin suite repeated. */
  async function withAdmin(body) {
    return withTemporaryAdmin(async (fx) => {
      const login = await fetch(`${BASE}/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: fx.email, password: fx.password }),
      }).then((r) => r.json());

      tokens.admin = login?.data?.accessToken ?? '';
      check('admin token', tokens.admin.length > 20, true);

      return body(fx);
    });
  }

  /**
   * Signs a brand-new customer in by OTP and holds the token. Returns the
   * mobile so the suite can reuse or clean it up.
   *
   * Exits rather than failing softly when `devCode` is absent: that means
   * NODE_ENV is not development, and every later assertion would be a
   * misleading failure.
   */
  async function loginCustomer(mobile = randomMobile()) {
    const sent = await call('POST', '/auth/otp/send', { mobile }, 200, 'none');
    const code = sent?.data?.devCode;

    if (!code) {
      console.error('no devCode — NODE_ENV must be development for this test');
      process.exit(1);
    }

    const verified = await call(
      'POST',
      '/auth/otp/verify',
      { mobile, code },
      200,
      'none',
    );

    tokens.customer = verified?.data?.accessToken ?? '';
    check('customer token', tokens.customer.length > 20, true);

    return { mobile, user: verified?.data?.user };
  }

  /** Asserts a route is unreachable unauthenticated. The 401 every suite owes. */
  async function noToken(method, path, body) {
    return call(method, path, body, 401, 'none');
  }

  /** Prisma client for fixtures and teardown; always disconnects. A suite that
   * leaves rows behind makes the next run's counts wrong. */
  async function cleanup(body) {
    const { PrismaClient } = await import('../dist/generated/prisma/client.js');
    const { PrismaPg } = await import('@prisma/adapter-pg');

    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    try {
      return await body(db);
    } finally {
      await db.$disconnect();
    }
  }

  /** Prints the tally and exits non-zero on any failure. Always call it last. */
  function done() {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }

  return {
    call,
    check,
    errorCode,
    section,
    withAdmin,
    loginCustomer,
    noToken,
    cleanup,
    done,
    day,
    randomMobile,
    /** Set a bearer the harness did not obtain itself (an instructor, say). */
    setToken: (who, value) => {
      tokens[who] = value ?? '';
    },
    counts: () => ({ pass, fail }),
  };
}
