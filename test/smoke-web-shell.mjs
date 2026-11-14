/**
 * Phase 0 — one header and one footer on every page of the website.
 *
 * Until 13 Nov the demo's 13 signed-in pages each carried their own
 * hand-written header, so the menu changed shape as the visitor moved and 28
 * footer links pointed at a dead `#footer` anchor.
 *
 * The assertions that matter are the **counts**. "The header is present" was
 * true before this work and after it; what was wrong is that there were
 * several of them, each different. So every page is checked for exactly one
 * `<header>`, exactly one `<footer>`, the same seven menu items and no
 * surviving `#footer` link.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-shell
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

const PAGES = [
  '/', '/find-a-trainer', '/trainer-profile', '/booking', '/checkout',
  '/booking-confirmed', '/login', '/dashboard', '/my-bookings', '/profile',
  '/notifications', '/reviews', '/help', '/support-tickets', '/refunds',
  '/billing', '/plans', '/goals', '/saved-trainers',
  '/session-details', '/workout-history', '/workout-plans',
  '/privacy-policy', '/terms-conditions',
];

/** The one menu, in order. */
const MENU = [
  ['Home', '/'],
  ['Explore Fitness', '/#categories'],
  ['Plans', '/plans'],
  ['Find a Trainer', '/find-a-trainer'],
  ['How It Works', '/#how'],
  ['About Us', '/#about-hellofit'],
  ['Contact', '/support-tickets'],
];

const count = (html, re) => (html.match(re) ?? []).length;

s.section(`one shell on all ${PAGES.length} pages`);

for (const path of PAGES) {
  const html = await fetch(SITE + path).then((r) => r.text());

  s.check(`${path} served`, html.length > 1000, true);
  s.check(`${path} — exactly one <header>`, count(html, /<header[\s>]/g), 1);
  s.check(`${path} — exactly one <footer>`, count(html, /<footer[\s>]/g), 1);
  s.check(`${path} — no dead #footer link`, html.includes('href="#footer"'), false);

  // Both shell wrappers must stay marked. `[data-hf-page]` in globals.css gives a
  // route's wrapper `min-height:100vh`; unmarked, the header and footer wrappers
  // matched it too and every page carried an empty viewport under each. Counting
  // headers never saw it — the shell was correct, its box was not.
  s.check(
    `${path} — both shell wrappers marked`,
    count(html, /data-hf-page="home" data-hf-shell=/g),
    2,
  );

  for (const [label, href] of MENU) {
    // Section anchors render bare on the homepage so the browser scrolls.
    const bare = href.startsWith('/#') ? href.slice(1) : href;
    const linked = html.includes(`href="${href}"`) || html.includes(`href="${bare}"`);
    s.check(`${path} — ${label}`, linked && html.includes(label), true);
  }
}

s.section('the two pages PDF 5.3 asks for and the demo never drew');

for (const path of ['/privacy-policy', '/terms-conditions']) {
  const html = await fetch(SITE + path).then((r) => r.text());
  s.check(`${path} says it awaits client content`, html.includes('awaiting content'), true);
}

s.done();
