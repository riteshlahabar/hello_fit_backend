/**
 * The customer dashboard's sidebar navigation — PDF 3.x, demo page
 * `hellofit-customer-dashboard.html`.
 *
 * The demo drove its six panels with an inline `gotoPage()` and a
 * `#menuToggle` listener. Neither was converted, so every sidebar button did
 * nothing and the mobile menu would not open. `DashboardNav.tsx` restores
 * exactly that behaviour; this proves it shipped.
 *
 * WHAT THIS CAN AND CANNOT PROVE. The component renders `null`, so a click
 * handler leaves no trace in server HTML — a page with the navigation and one
 * without look identical. So this suite checks the two halves that *are*
 * observable over HTTP:
 *
 *   1. the preconditions the handler needs — six panels, six buttons with
 *      `data-page`, exactly one starting `active`, and the `#sidebar` and
 *      `#menuToggle` it reaches for;
 *   2. that the handler code is really in the deployed bundle, by fetching the
 *      page's own JS chunks and looking for `NAV_MARKER`.
 *
 * A click actually switching panels is a browser assertion, not an HTTP one,
 * and is deliberately out of scope here rather than faked.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-dashboard
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const NAV_MARKER = 'hf-dashboard-nav-ready';

/** The six panels the demo shipped, and the button that reveals each. */
const PAGES = ['overview', 'bookings', 'saved', 'goals', 'profile', 'settings'];

const s = smoke();

s.section('the page is served');

const html = await fetch(`${SITE}/dashboard`).then((r) => r.text());
s.check('dashboard served', html.length > 1000, true);
s.check('it is the converted page', html.includes('data-hf-page="dashboard"'), true);

s.section('every panel the navigation targets exists');

for (const page of PAGES) {
  s.check(`panel page-${page} present`, html.includes(`id="page-${page}"`), true);
  s.check(`button for ${page} present`, html.includes(`data-page="${page}"`), true);
}

s.section('exactly one panel starts open');

// `.page-panel{display:none}` with `.active{display:block}` is the design's
// own CSS, so two actives would show two panels stacked and none would show a
// blank dashboard. Overview is the demo's default.
const actives = (html.match(/class="page-panel active"/g) ?? []).length;
s.check('one active panel', actives, 1);
s.check('and it is overview', /class="page-panel active" id="page-overview"/.test(html), true);

const activeButtons = (html.match(/class="nav-btn active"/g) ?? []).length;
s.check('one active nav button', activeButtons, 1);

s.section('what the toggle reaches for');

s.check('#sidebar present', html.includes('id="sidebar"'), true);
s.check('#menuToggle present', html.includes('id="menuToggle"'), true);

s.section('the handler is in the deployed bundle');

// Next.js inlines nothing useful in the HTML for a null-rendering client
// component, so follow the page's own script tags. A build that dropped
// DashboardNav would serve identical HTML and fail only here.
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

s.section('every fabricated value is gone from the source');

// These were asserted PRESENT in the first version of this suite, as a record
// of audit item 10. They are now asserted ABSENT, which is the whole point of
// the change: not one of them can come back without this failing.
for (const fake of [
  'Aditya',                    // someone else's name, shown to every customer
  'aditya@example.com',
  '98765 43210',
  'Member since Oct 2026',     // no createdAt on the profile to support it
  '>12<',                      // total sessions
  '>75%<',                     // a progress figure against a goal that does not exist
  'Complete 12 sessions',
  '12 session goal',
  '3 to go',
  'Sample bookings',
  'sample data',
  'prototype',
]) {
  s.check(`"${fake}" gone`, html.includes(fake), false);
}

s.section('what replaced them');

// The live values arrive in the browser, so the server HTML carries the
// loading and unknown states rather than the numbers themselves. Asserting
// those proves the live components are mounted and the literals are not.
s.check('identity renders a placeholder, not a name', html.includes('Good morning,'), true);
s.check('the unknown marker is used', html.includes('—'), true);
s.check('bookings panel mounted', html.includes('id="allBookingList"'), true);
s.check('its filter still exists', html.includes('id="bookingFilter"'), true);

// The filter's third option described a status the API cannot return.
s.check('"Awaiting confirmation" dropped', html.includes('Awaiting confirmation'), false);
s.check('replaced by Completed', html.includes('>Completed<'), true);

s.section('the profile panel is the live form');

// The form itself is NOT in this HTML, and that is the correct answer rather
// than a gap: the panel is token-gated and fetches in the browser, so the
// server renders its loading state — the same thing `smoke:web-pages` asserts
// for every other wired page. Which fields end up editable is a browser
// assertion; what is provable here is that the demo's filled-in form is gone
// and a loading component stands in its place.
s.check('live profile component mounted', html.includes('Loading your details'), true);
s.check('the demo form is not server-rendered', html.includes('defaultValue="Aditya'), false);

s.done();
