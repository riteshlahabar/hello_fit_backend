/**
 * Find a Trainer, wired — PDF §5.5 and §5.6, through the site's own origin.
 *
 * The assertions that matter are the **negative** ones, for the same reason as
 * `smoke-provider-search.mjs`: a page still showing the demo's six invented
 * trainers looks perfectly healthy. Every one of their names is asserted gone,
 * because each was a person who does not exist with a Book button under them.
 *
 * The filter option lists are checked too. They were hard-coded in the demo
 * ("Personal Training", "Mumbai") and are now administered — a category the
 * client retires in the admin panel must leave this page with it.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-find-a-trainer
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

const get = (path) => fetch(SITE + path).then((r) => r.text());

/** The six people the demo invented. None may survive anywhere on the page. */
const INVENTED = [
  'Sneha Patil',
  'Rahul Sharma',
  'Neha Kulkarni',
  'Amit Deshmukh',
  'Kavya Rao',
  'Arjun Verma',
];

s.section('the page is served and the invented trainers are gone');

const html = await get('/find-a-trainer');

s.check('served', html.length > 1000, true);
s.check('no "Profile sample" ribbon', html.includes('Profile sample'), false);
s.check('no "6 sample trainer profiles"', html.includes('sample trainer profiles'), false);

for (const name of INVENTED) {
  s.check(`invented "${name}" gone`, html.includes(name), false);
}

s.section('live providers render');

// The approved seed provider. One is correct: only one is approved, which is
// data entry rather than code (worklog, 12 Nov).
s.check('the approved provider is listed', html.includes('Asha Kulkarni'), true);
s.check('count comes from the API', /Showing \d+ trainer/.test(html), true);
s.check('verified badge, not "sample"', html.includes('Verified'), true);
s.check('a profile link carries the id', /\/trainer-profile\?id=[0-9a-f-]{36}/.test(html), true);

s.section('filters are administered, not invented');

s.check('demo city "Mumbai" not hard-coded', html.includes('>Mumbai<'), false);
s.check('demo category "Weight Loss" not hard-coded', html.includes('>Weight Loss<'), false);
s.check('a live category is offered', html.includes('Yoga'), true);
s.check('session location filter present', html.includes("At trainer&#x27;s location") || html.includes("At trainer's location"), true);
s.check('price slider kept', html.includes('price-range'), true);
s.check('rating filter kept', html.includes('rating-filter'), true);

s.section('the header menu can be opened');

// The demo's `#hamb` button and the MobileNav that wired it both went with
// the thirteen inline headers on 13 Nov. The shared Header owns its toggle in
// React state and is server-rendered, so it can be asserted directly.
s.check('menu toggle present', html.includes('aria-label="Toggle menu"'), true);
s.check('nav container present', html.includes('nav-links'), true);
s.check('no orphaned demo hamburger', html.includes('id="hamb"'), false);

s.section('the homepage still routes into this page');

const home = await get('/');
s.check('homepage links to find-a-trainer', home.includes('/find-a-trainer'), true);
s.check('homepage still live', /categor/i.test(home), true);


s.section('one menu on every marketing page (client, 13 Nov)');

// The demo disagreed with itself — four items on the homepage, six on the
// inner pages — so clicking Home made half the menu vanish. These assertions
// are what stops that coming back.
const MENU = [
  ['Home', '/'],
  ['Explore Fitness', '/#categories'],
  ['Find a Trainer', '/find-a-trainer'],
  ['How It Works', '/#how'],
  ['About Us', '/#about-hellofit'],
  ['Contact', '/support-tickets'],
];

for (const path of ['/', '/find-a-trainer', '/booking', '/checkout', '/trainer-profile']) {
  const page = path === '/' ? home : await get(path);
  for (const [label, href] of MENU) {
    // On the homepage the section anchors are rendered bare (#categories) so
    // the browser scrolls instead of navigating; elsewhere they carry the `/`.
    const bare = href.startsWith('/#') ? href.slice(1) : href;
    const linked = page.includes(`href="${href}"`) || page.includes(`href="${bare}"`);
    s.check(`${path} menu has ${label}`, linked && page.includes(label), true);
  }
}
s.done();
