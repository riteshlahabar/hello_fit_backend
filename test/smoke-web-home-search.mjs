/**
 * The homepage hero search, driven by the admin panel — PDF 6.5.
 *
 * Its tabs were a hardcoded array in `src/data/home.ts` listing six services,
 * two of which ("Mobility", "Functional Fitness") **did not exist in the
 * database at all** — the homepage advertised things nobody could book. Tabs
 * now come from `GET /categories` and the service suggestions from
 * `GET /services`, which is what the panel's Catalog screens write.
 *
 * The assertion that matters is the round trip: an administrator creates a
 * category, and it reaches the customer's homepage. That is 6.5's acceptance
 * criterion verbatim — "Active categories appear on customer-facing
 * platforms" — so it is tested rather than assumed.
 *
 * ONE THING THIS CANNOT SHORTEN: the homepage is ISR with a 5-minute window
 * (`DEFAULT_REVALIDATE`), so a brand-new category appears in the *API*
 * immediately and in the *rendered page* on the next revalidation. The suite
 * asserts the API instantly and the page against what is already published,
 * rather than sleeping for five minutes.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-home-search
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

const stamp = String(Date.now()).slice(-5);
const made = { categoryId: '' };

s.section('what the public catalog offers');

const cats = await s.call('GET', '/categories', undefined, 200, 'none');
const svcs = await s.call('GET', '/services', undefined, 200, 'none');

s.check('categories answer', Array.isArray(cats?.data), true);
s.check('services answer', Array.isArray(svcs?.data), true);
s.check('there is at least one category to tab', cats.data.length > 0, true);
s.check('every category carries an id to filter by', cats.data.every((c) => typeof c.id === 'string'), true);
s.check('every service names its category', svcs.data.every((x) => x.category?.id), true);

s.section('an administrator creates a category, and it reaches the API');

await s.withAdmin(async () => {
  const created = await s.call('POST', '/admin/catalog/categories', {
    name: `Smoke Aerial ${stamp}`,
    description: 'Created by smoke:web-home-search',
  }, 201);

  made.categoryId = created?.data?.id ?? '';
  s.check('category created', made.categoryId.length > 20, true);
});

const after = await s.call('GET', '/categories', undefined, 200, 'none');
s.check(
  'the new category is public immediately',
  after.data.some((c) => c.id === made.categoryId),
  true,
);
s.check('and it would render as a tab', after.data.length, cats.data.length + 1);

s.section('deactivating it takes it off the customer side');

// 6.5: "Inactive categories are handled according to the agreed visibility
// rules." The public list is the agreed rule — an inactive category is not on
// it, so the tab disappears.
await s.withAdmin(async () => {
  await s.call('PATCH', `/admin/catalog/categories/${made.categoryId}`, { isActive: false });
});

const hidden = await s.call('GET', '/categories', undefined, 200, 'none');
s.check(
  'deactivated category is gone from the public list',
  hidden.data.some((c) => c.id === made.categoryId),
  false,
);

s.section('the rendered homepage is API-driven, not the old array');

const html = await fetch(`${SITE}/`).then((r) => r.text());
s.check('homepage served', html.length > 1000, true);

// The two fictional tabs. Their absence is the proof the array is gone.
s.check('"Functional Fitness" tab gone', html.includes('Functional Fitness'), false);
s.check('"Mobility & Flexibility" gone', html.includes('Mobility & Flexibility'), false);

// And real rows are present. Taken from the live response rather than
// hardcoded here, so reseeding cannot make this suite lie.
//
// Escaped before comparing: "Back & Neck Therapy" is served as
// "Back &amp; Neck Therapy", and a raw comparison fails on the one seeded
// service with an ampersand in its name while passing on all the others —
// which looks like a missing service rather than a test bug.
const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const liveNames = svcs.data.slice(0, 3).map((x) => x.name);
for (const name of liveNames) {
  s.check(`live service "${name}" offered`, html.includes(escape(name)), true);
}

s.check('the datalist of live services is rendered', html.includes('id="serviceOptions"'), true);

s.section('search leads somewhere real');

// It used to raise a toast saying the results page "will be built next".
s.check('no "will be built next" toast copy', html.includes('will be built next'), false);
s.check('Find your trainer links to the page', html.includes('href="/find-a-trainer"'), true);

s.section('cleanup');

await s.cleanup((db) => db.serviceCategory.deleteMany({ where: { id: made.categoryId } }));

s.done();
