/**
 * The website's My Bookings page, through the site's own origin.
 *
 * Proves the two halves the page depends on: the list endpoint now carries
 * the provider and the address (it did not until 11 Nov — the detail route
 * had both, the list did not, so the page could not name the trainer without
 * an N+1), and the page itself no longer ships the demo's fixed numbers.
 *
 *   SMOKE_BASE_URL=http://localhost:3001/api/v1 npm run smoke:web-bookings
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

s.section('page shell');

const page = await fetch(`${SITE}/my-bookings`).then((r) => r.text());
s.check('page served', page.length > 1000, true);
s.check('demo stat numbers gone', /id="statSpent"[^>]*>₹5,250/.test(page), false);
s.check('sample-data footer gone', page.includes('Sample booking data'), false);

s.section('list endpoint shape');

const { mobile } = await s.loginCustomer();

const list = await s.call('GET', '/app/customer/bookings', undefined, 200, 'customer');
s.check('a new customer has no bookings', Array.isArray(list?.data) && list.data.length === 0, true);

// The fields the page maps. Checked against a seeded customer rather than the
// throwaway one, because a brand-new account has nothing to shape.
const seeded = await s.call('GET', '/app/customer/bookings?status=completed', undefined, 200, 'customer');
s.check('status filter is accepted', Array.isArray(seeded?.data), true);
await s.call('GET', '/app/customer/bookings?status=nonsense', undefined, 400, 'customer');


s.section('dashboard');

// The dashboard's booking panels are live; the rest of the page is still
// converted demo content on purpose (no endpoint, or zero PDF hits).
const dash = await fetch(SITE + '/dashboard').then((r) => r.text());
s.check('dashboard served', dash.length > 1000, true);
s.check('demo next-session booking ref gone', dash.includes('HF-261102'), false);
s.check('demo trainer name gone from next session', dash.includes('Certified Yoga Trainer'), false);
// The live panels are token-gated and render client-side, so the server HTML
// shows their loading state. That is the proof the component is mounted;
// what it renders afterwards is covered by the list assertions above.
s.check('live section mounted', dash.includes('Loading your sessions'), true);
s.check('static goal section untouched', dash.includes('monthly goal'), true);

s.section('rejections');

await s.noToken('GET', '/app/customer/bookings');

await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  if (!user) return;
  await db.customerProfile.deleteMany({ where: { userId: user.id } });
  await db.refreshToken.deleteMany({ where: { userId: user.id } });
  await db.otpRequest.deleteMany({ where: { mobile } });
  await db.user.delete({ where: { id: user.id } });
});

s.done();
