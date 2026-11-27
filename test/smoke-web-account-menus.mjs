/**
 * The one account sidebar, across every signed-in page (client, 27-11-2026).
 *
 * The complaint this guards against was specific: the sidebar's My Bookings
 * and the avatar dropdown's My Bookings opened different pages, and the
 * dropdown's one opened with no sidebar at all. So the contract is now
 * **every account route serves the same sidebar**, and this suite is the only
 * thing that notices when a new page is added without one.
 *
 * It also asserts the deletions, because a deletion is the thing most likely
 * to be quietly undone by a later edit: three dead profile sections and two
 * duplicate notification screens.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-account-menus
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';

/** Every route the sidebar itself offers. All of them must carry it. */
const ACCOUNT_ROUTES = [
  '/dashboard',
  '/my-bookings',
  '/saved-trainers',
  '/goals',
  '/profile',
  '/notifications',
  '/billing',
  '/refunds',
];

const s = smoke();
const pages = {};

s.section('every account page serves the shared sidebar');

for (const route of ACCOUNT_ROUTES) {
  const response = await fetch(SITE + route);
  const html = await response.text();
  pages[route] = html;

  s.check(`${route} served`, response.status, 200);
  s.check(`${route} has the sidebar`, html.includes('hf-account-sidebar'), true);
  s.check(`${route} has the shell`, html.includes('hf-account-shell'), true);
  // The toggle targets `#sidebar`; without it the mobile menu opens nothing.
  s.check(`${route} has #sidebar`, html.includes('id="sidebar"'), true);
}

s.section('the sidebar offers the same eight rows everywhere');

for (const [route, html] of Object.entries(pages)) {
  const missing = ACCOUNT_ROUTES.filter((href) => !html.includes(`href="${href}"`));
  s.check(`${route} links to all eight`, missing, []);
}

s.section('My Bookings is one page, and it is the full one');

const bookings = pages['/my-bookings'];
s.check('the heading came across', bookings.includes('All sessions'), true);
s.check('stat tiles are here', bookings.includes('id="statUpcoming"'), true);

// The list itself is token-gated and fetches in the browser, so what the
// server can be asked for is its loading state — the same answer
// `smoke:web-pages` takes for every other wired page. The search box and the
// tabs only exist once the bookings land, which is a browser assertion.
s.check('the list is mounted', bookings.includes('Loading your bookings'), true);

s.section('My Profile is one screen with an Edit button');

const profile = pages['/profile'];
s.check('Edit button present', profile.includes('id="editProfile"'), true);
s.check('titled My Profile', profile.includes('<h1>My Profile</h1>'), true);
s.check('personal information panel', profile.includes('Personal information'), true);
s.check('photo strip present', profile.includes('id="largeAvatar"'), true);

// Read-only until Edit is pressed, which is the client's "unlock in place".
// The read-only rows carry no ids, so an id here means an input is rendered.
s.check('no name input at rest', profile.includes('id="firstName"'), false);
s.check('no date picker at rest', profile.includes('type="date"'), false);
s.check('no Save button at rest', profile.includes('Save changes'), false);
s.check('values are shown instead', profile.includes('class="value"'), true);

s.section('the three dead profile sections are gone');

for (const dead of [
  'Password &amp; security',
  'id="passwordForm"',
  'Connect Google',
  'Fitness &amp; app preferences',
  'Privacy &amp; account',
  'Request account deletion',
  'Download my information',
]) {
  s.check(`"${dead}" gone`, profile.includes(dead), false);
}

// Its own five-row tab strip went with them.
s.check('old tab strip gone', profile.includes('data-section='), false);

s.section('one notification screen, not three');

// A dead copy lived on /profile and another on /dashboard. The live one is
// /notifications, and it is the only place the switches may appear.
const live = pages['/notifications'];
s.check('live preferences card', live.includes('Notification preferences'), true);
s.check('its channels', live.includes('SMS reminders'), true);

for (const route of ['/profile', '/dashboard']) {
  s.check(`${route} has no switches`, pages[route].includes('Notification preferences'), false);
  s.check(`${route} has no toggles`, pages[route].includes('class="switch"'), false);
}

s.section('Explore trainers works from every sidebar');

for (const [route, html] of Object.entries(pages)) {
  s.check(`${route} offers the link`, html.includes('href="/find-a-trainer"'), true);
}

s.done();
