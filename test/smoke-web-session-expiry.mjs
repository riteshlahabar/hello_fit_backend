/**
 * What the website does when a customer's session dies under their feet.
 *
 * **The bug.** `JWT_ACCESS_TTL` is 15 minutes and the website never spent the
 * 30-day refresh token it was issued — `refreshSession()` existed in
 * `src/lib/auth.ts` and nothing called it. So a customer left on the dashboard
 * was logged out after a quarter of an hour, and the page did not say so: the
 * shell, the sidebar and every panel stayed on screen with the live numbers
 * replaced by dashes and "Sign in to see your sessions" where the bookings had
 * been. Signed out, still looking at the signed-in dashboard.
 *
 * The fix is two halves and this suite asserts the contract under both:
 *
 *   1. renew — an expired access token is swapped for a fresh one and the
 *      request is retried, so most expiries are never seen;
 *   2. eject — when there is nothing left to renew, `/login?expired=1`.
 *
 * The redirect itself is client-side JavaScript and cannot be fetched, so what
 * is asserted here is the API behaviour it keys off (an *expired* token is a
 * 401, a refresh really does rotate) plus the server HTML of the two pages the
 * fix touches, which is where an SSR regression would show.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-session-expiry
 */
import jwt from 'jsonwebtoken';
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const BOOKINGS = '/app/customer/bookings';
const s = smoke();

s.section('a live session to expire');

const { mobile } = await s.loginCustomer();

// Both tokens are needed, and the harness keeps only the access one — so log
// in again on the same mobile and hold the pair.
const sent = await s.call('POST', '/auth/otp/send', { mobile }, 200, 'none');
const verified = await s.call(
  'POST',
  '/auth/otp/verify',
  { mobile, code: sent?.data?.devCode },
  200,
  'none',
);

const access = verified?.data?.accessToken;
const refresh = verified?.data?.refreshToken;
s.check('access token issued', typeof access, 'string');
s.check('refresh token issued', typeof refresh, 'string');

s.setToken('customer', access);
await s.call('GET', BOOKINGS, undefined, 200, 'customer');

s.section('an EXPIRED access token is a 401 — the trigger');

// Signed with the real secret and the real claims, only already past its `exp`.
// A garbage string would 401 too and prove nothing: the website must treat
// "your 15 minutes are up" the same as any other refusal of a token it sent,
// and that is the case this re-creates without waiting a quarter of an hour.
const claims = jwt.decode(access);
const expired = jwt.sign(
  { sub: claims.sub, role: claims.role, ...(claims.mobile ? { mobile: claims.mobile } : {}) },
  process.env.JWT_ACCESS_SECRET,
  { expiresIn: '-1s' },
);

s.setToken('customer', expired);
const refused = await s.call('GET', BOOKINGS, undefined, 401, 'customer');
s.check('refused with an error code', s.errorCode(refused) !== undefined, true);

s.section('the refresh token renews it — half one, "renew"');

const renewed = await s.call('POST', '/auth/refresh', { refreshToken: refresh }, 200, 'none');
const fresh = renewed?.data?.accessToken;
s.check('a new access token comes back', typeof fresh, 'string');
s.check('and it is not the expired one', fresh === expired, false);

// Rotation: the website must keep the new refresh token or the next renewal
// spends a token the server has already retired.
const rotated = renewed?.data?.refreshToken;
s.check('the refresh token rotated', typeof rotated, 'string');
s.check('to a different value', rotated === refresh, false);

s.section('and the retried request succeeds with it');

s.setToken('customer', fresh);
const retried = await s.call('GET', BOOKINGS, undefined, 200, 'customer');
s.check('bookings readable again', Array.isArray(retried?.data), true);

s.section('a spent refresh token cannot renew — half two, "eject"');

// The old one was consumed by the rotation above. This is the state that makes
// `recoverSession()` return null, which is what sends the customer to
// /login?expired=1 instead of leaving them on a dead dashboard.
const spent = await s.call('POST', '/auth/refresh', { refreshToken: refresh }, 401, 'none');
s.check('the spent token is refused', s.errorCode(spent) !== undefined, true);
await s.call('POST', '/auth/refresh', { refreshToken: 'nonsense' }, 401, 'none');

s.section('the login screen says why it is being shown');

// `?expired=1` is read with `useSearchParams`, which Next needs a Suspense
// boundary around on this statically rendered page. Without one the build
// fails; with a badly placed one the panel disappears from the server HTML.
const login = await fetch(`${SITE}/login?expired=1`).then((r) => r.text());
s.check('the auth panel still renders', login.includes('class="auth-wrap"'), true);
s.check('the message slot is there', login.includes('id="message"'), true);
s.check('and the OTP form with it', login.includes('WELCOME TO HELLOFIT'), true);

s.section('the dashboard shell survives the sign-in guard');

// `RequireSignIn` renders nothing and must stay that way: the client's design
// is this page, and smoke:web-logout asserts the shell's own markup.
const dash = await fetch(`${SITE}/dashboard`).then((r) => r.text());
s.check('sidebar intact', dash.includes('YOUR SPACE'), true);
s.check('avatar menu intact', dash.includes('aria-haspopup="menu"'), true);
s.check('next-session section intact', dash.includes('Your next session'), true);

s.done();
