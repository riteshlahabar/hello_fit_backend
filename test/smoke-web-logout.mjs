/**
 * Customer logout — PDF §3.1 and §5.1, both of which make it an acceptance
 * criterion: "The customer can log out", "The customer can log out securely".
 *
 * The word that matters is **securely**. The website used to "log out" by
 * clearing localStorage, which leaves the refresh token valid on the server
 * for its full 30 days — anyone holding a copy could keep minting access
 * tokens for a session the customer believed they had ended. So the assertion
 * this suite exists for is the revocation, not the button:
 *
 *   log in -> refresh works -> log out -> THE SAME refresh token is refused.
 *
 * Everything else here is secondary.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-logout
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

s.section('a real session, so there is something to revoke');

const { mobile } = await s.loginCustomer();
s.check('mobile issued', typeof mobile, 'string');

// The harness holds the access token; the refresh token has to be taken from
// the login response, so log in a second time on the same mobile and keep both.
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

s.section('the refresh token works before logging out');

const before = await s.call('POST', '/auth/refresh', { refreshToken: refresh }, 200, 'none');
s.check('refresh returns a new access token', typeof before?.data?.accessToken, 'string');

// Rotating refresh: that call consumed the old token and issued a new one, so
// the logout below must use the current one or it proves nothing.
const current = before?.data?.refreshToken;
s.check('refresh rotated', typeof current, 'string');
s.check('and it is a different token', current === refresh, false);

s.section('logout revokes it — the whole point');

s.setToken('customer', before?.data?.accessToken ?? access);
const out = await s.call('POST', '/auth/logout', { refreshToken: current }, 200, 'customer');
s.check('logout accepted', out?.message ?? null, 'Signed out');

const after = await s.call('POST', '/auth/refresh', { refreshToken: current }, 401, 'none');
s.check('the revoked token is refused', s.errorCode(after) !== undefined, true);

s.section('refusals');

// An unauthenticated logout must not be a way to revoke someone else's token.
await s.call('POST', '/auth/logout', { refreshToken: current }, 401, 'none');
// And the body is required.
s.setToken('customer', before?.data?.accessToken ?? access);
await s.call('POST', '/auth/logout', {}, 400, 'customer');

s.section('the avatar menu is on every signed-in page');

// Client's instruction, 12 Nov 2026: logout lives in the topbar avatar
// dropdown and nowhere else, so it has to be reachable from all of them. The
// menu is a client component, so the server HTML carries the trigger — the
// `aria-haspopup` avatar — and the items render on click.
const PAGES = [
  '/dashboard', '/profile', '/my-bookings', '/notifications', '/reviews',
  '/billing', '/goals', '/help', '/refunds', '/plans',
  '/saved-trainers', '/support-tickets', '/workout-history', '/workout-plans',
];

for (const path of PAGES) {
  const page = await fetch(SITE + path).then((r) => r.text());
  s.check(`${path} has the avatar menu`, page.includes('aria-haspopup="menu"'), true);
  s.check(`${path} keeps the design .avatar class`, /class="avatar"/.test(page), true);
}

s.section('and the hardcoded initials are gone with it');

// Every one of these pages shipped a literal pair of initials in the topbar —
// HF, SP or JD — shown to whoever was signed in. The menu derives them.
for (const path of ['/my-bookings', '/billing', '/workout-plans', '/help']) {
  const page = await fetch(SITE + path).then((r) => r.text());
  const literal = /<div class="avatar"[^>]*>(HF|SP|JD)</.test(page);
  s.check(`${path} no literal initials`, literal, false);
}

s.section('logout is NOT in the dashboard sidebar any more');

// It was there first, as a `.nav-btn` in the ACCOUNT group. The client asked
// for one place only, so a second control reappearing is a regression.
const dash = await fetch(`${SITE}/dashboard`).then((r) => r.text());
s.check('no sidebar logout nav-btn', /class="nav-btn"[^>]*>\s*<span class="ico">⎋/.test(dash), false);

s.section('the homepage carries the same header as every other page');

// Until 13 Nov this asserted the homepage had NO avatar menu, because `/`
// used the marketing header and the account pages used their own topbars.
// The client then asked for one header everywhere, signed in or not
// (13 Nov 2026), so the avatar is now on the homepage too — and that is the
// instruction, not a regression. AvatarMenu offers Log in when signed out,
// Log out when signed in, which is why one control can serve both.
const home = await fetch(`${SITE}/`).then((r) => r.text());
s.check('homepage has the shared avatar menu', home.includes('aria-haspopup="menu"'), true);
s.check('and still offers Log in to a visitor', home.includes('Log in'), true);

s.done();
