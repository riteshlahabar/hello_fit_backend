/**
 * The website's login path (PDF §3.1), through the site's own origin.
 *
 * `SMOKE_BASE_URL` points at the Next.js dev server's `/api/v1` rewrite, so
 * one run proves what a browser would exercise: the proxy is wired, and the
 * two OTP calls the login page makes actually work. No browser needed.
 *
 *   npx next dev -p 3001          # in hellofit_customer_web
 *   npm run smoke:web-login
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

s.section('dev proxy');

const health = await s.call('GET', '/health', undefined, 200, 'none');
s.check('API reachable through the site origin', health?.data?.status, 'ok');
s.check('and its database is up', health?.data?.database, 'up');

s.section('login page');

const page = await fetch(`${SITE}/login`).then((r) => r.text());
s.check('login page served', page.length > 1000, true);
s.check('OTP field asks for a mobile, not an email', page.includes('10-digit mobile number'), true);
s.check('six-digit code field present', page.includes('digit verification code'), true);
s.check('send button present', page.includes('SEND ONE-TIME CODE'), true);
// .message is display:none until it also carries 'show' (page.css:59). Without
// it the dev OTP code rendered invisibly and the flow looked broken.
s.check('message bar can show', page.includes('class="message'), true);


s.section('home page entry points');

const home = await fetch(SITE).then((r) => r.text());
s.check('Log in links to the login page', /href="\/login"[^>]*>\s*Log in/.test(home), true);
s.check('Get Started links to it too', /href="\/login"[^>]*>\s*Get Started/.test(home), true);
s.check('no placeholder toast left', home.includes('will be designed next'), false);

s.section('otp round trip');

const { mobile } = await s.loginCustomer();
s.check('a token came back', s.counts().fail, 0);

// The page's own second call: the profile the token unlocks.
const profile = await s.call('GET', '/app/customer/profile', undefined, 200, 'customer');
s.check('profile reachable with that token', typeof profile?.data?.id, 'string');

s.section('rejections');

await s.call('POST', '/auth/otp/verify', { mobile, code: '000000' }, 401, 'none');
await s.call('POST', '/auth/otp/send', { mobile: '12345' }, 400, 'none');
await s.noToken('GET', '/app/customer/profile');

await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  if (!user) return;
  await db.customerProfile.deleteMany({ where: { userId: user.id } });
  await db.refreshToken.deleteMany({ where: { userId: user.id } });
  await db.otpRequest.deleteMany({ where: { mobile } });
  await db.user.delete({ where: { id: user.id } });
});

s.done();
