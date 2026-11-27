/**
 * The customer dashboard — demo page `hellofit-customer-dashboard.html`.
 *
 * **Rewritten 27-11-2026, and the inversion is the point.** Until today this
 * suite asserted that six `.page-panel` sections and six `data-page` buttons
 * were PRESENT: the demo drove the whole account area from inside this one
 * page. The client had that removed — every account row is a link to a real
 * route, and the dashboard keeps Overview alone — so the same facts are now
 * asserted ABSENT. Not one panel can come back without this failing.
 *
 * What is still only provable in a browser (a click, a hover) stays out of
 * scope rather than being faked. The one thing that leaves no trace in server
 * HTML is `DashboardNav`, which renders `null`; it is proved by fetching the
 * page's own JS chunks and looking for `NAV_MARKER`.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-dashboard
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const NAV_MARKER = 'hf-dashboard-nav-ready';

const s = smoke();

s.section('the page is served');

const html = await fetch(`${SITE}/dashboard`).then((r) => r.text());
s.check('dashboard served', html.length > 1000, true);
s.check('it is the converted page', html.includes('data-hf-page="dashboard"'), true);

s.section('the in-page panels are gone');

// `.page-panel` and `data-page` were the whole switching mechanism. One of
// either means a panel came back.
s.check('no .page-panel sections', html.includes('page-panel'), false);
s.check('no data-page buttons', html.includes('data-page='), false);

for (const panel of ['bookings', 'saved', 'goals', 'profile', 'settings']) {
  s.check(`panel page-${panel} gone`, html.includes(`id="page-${panel}"`), false);
}

// The two components the panels carried, absorbed by /my-bookings and /profile.
s.check('bookings panel gone', html.includes('id="allBookingList"'), false);
s.check('its filter gone', html.includes('id="bookingFilter"'), false);
s.check('profile form gone', html.includes('Loading your details'), false);

s.section('the dead Settings panel is gone');

// Three switches that saved nothing and duplicated /notifications.
for (const dead of [
  'Booking reminders',
  'Offers and wellness tips',
  'id="saveSettings"',
  'Control your HelloFit experience',
]) {
  s.check(`"${dead}" gone`, html.includes(dead), false);
}

s.section('the shared account sidebar is on the page');

s.check('shared sidebar rendered', html.includes('hf-account-sidebar'), true);
s.check('shared shell rendered', html.includes('hf-account-shell'), true);
s.check('the page no longer draws its own', html.includes('class="sidebar"'), false);

// Every row is a real link now. A missing href is a row that goes nowhere.
for (const href of [
  '/dashboard',
  '/my-bookings',
  '/saved-trainers',
  '/goals',
  '/profile',
  '/notifications',
  '/billing',
  '/refunds',
]) {
  s.check(`row links to ${href}`, html.includes(`href="${href}"`), true);
}

s.check('Overview renamed', html.includes('>Overview<'), false);
s.check('to Dashboard', html.includes('Dashboard'), true);
s.check('Settings row gone', html.includes('⚙</span> Settings'), false);

s.section('Explore trainers is a real link');

// It was `<button id="findTrainerSide">` with no handler — it did nothing.
s.check('dead button gone', html.includes('findTrainerSide'), false);
s.check('links to find-a-trainer', html.includes('href="/find-a-trainer"'), true);
s.check('copy kept', html.includes('Ready for your next session?'), true);

s.section('what the mobile toggle reaches for');
s.check('#sidebar present', html.includes('id="sidebar"'), true);
s.check('sidebar toggle present', html.includes('id="menuToggle"'), true);

s.section('the handler is in the deployed bundle');

// Next.js inlines nothing useful for a null-rendering client component, so
// follow the page's own script tags. A build that dropped DashboardNav would
// serve identical HTML and fail only here.
const chunks = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
s.check('page ships JS chunks', chunks.length > 0, true);

let foundMarker = false;
for (const chunk of chunks) {
  const code = await fetch(SITE + chunk).then((r) => (r.ok ? r.text() : ''));
  if (code.includes(NAV_MARKER)) {
    foundMarker = true;
    break;
  }
}
s.check(`NAV_MARKER "${NAV_MARKER}" in a chunk`, foundMarker, true);

s.section('every fabricated value is still gone');

for (const fake of [
  'Aditya',                    // someone else's name, shown to every customer
  'aditya@example.com',
  '98765 43210',
  'Member since Oct 2026',     // no createdAt on the profile to support it
  '>12<',                      // total sessions
  '>75%<',                     // a progress figure against a goal that does not exist
  'Complete 12 sessions',
  'Sample bookings',
  'sample data',
  'prototype',
]) {
  s.check(`"${fake}" gone`, html.includes(fake), false);
}

s.section('what replaced them');

// The live values arrive in the browser, so the server HTML carries the
// loading and unknown states rather than the numbers. `lib/greeting.ts` pins a
// server render to band 0 so hydration has something stable to correct, which
// is why "Good Morning" is what the HTML always carries whatever the hour.
// **Not `'Good Morning,'`** — React writes a `<!-- -->` marker between
// adjacent text nodes, so the comma never sits against the greeting.
s.check('identity renders the greeting', html.includes('Good Morning'), true);
s.check('and a placeholder, not a name', /Good Morning(<!-- -->)?, /.test(html), true);
s.check('the unknown marker is used', html.includes('—'), true);

s.done();
