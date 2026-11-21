/**
 * The Package page, wired — client, 17 Nov 2026.
 *
 * Replaces `smoke-web-plans.mjs`. Membership plans were deleted; the page at
 * /packages now lists the administered packages, and /plans is gone.
 *
 * The negative assertions carry the weight, as everywhere else here: a page
 * still rendering the demo's membership tiers looks perfectly healthy.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-packages
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();
const stamp = String(Date.now()).slice(-6);

let madeId = '';
// The package is sold on a service (client, 18 Nov 2026): a package with no
// service ticked is shown nowhere, so the fixture picks one up front.
const services = await s.call('GET', '/services', undefined, 200, 'none');
const target = (services?.data ?? [])[0];
s.check('a service exists to sell against', Boolean(target), true);


s.section('an administered package reaches the website');

await s.withAdmin(async () => {
  const created = await s.call(
    'POST',
    '/admin/packages',
    {
      name: `Web Pack ${stamp}`,
      icon: '🧪',
      sessionCount: 12,
      validityDays: 45,
      percentAdjust: -17,
      freeSessionCount: 2,
      sortOrder: 50,
      serviceIds: [target.id],
    },
    201,
  );

  madeId = created?.data?.id ?? '';
  s.check('package created', madeId.length > 20, true);
});

const published = await s.call('GET', '/packages', undefined, 200, 'none');
const mine = (published?.data ?? []).find((row) => row.id === madeId);

s.check('the new package is public', Boolean(mine), true);
s.check('its sessions', mine?.sessionCount, 12);
s.check('its validity', mine?.validityDays, 45);
s.check('its percent', mine?.percentAdjust, -17);
s.check('its free sessions', mine?.freeSessionCount, 2);
// A package holds a percent; the rate belongs to the service, so the page
// shows terms and never a rupee figure of its own.
s.check('no price without a service', mine?.price, null);

s.section('no service picked: the prompt, not the cards');

/**
 * **These six moved behind `?service=` on 18 Nov 2026** and this suite went on
 * asking for them at `/packages`, so it failed for three days reporting the
 * card as broken when the card was correctly absent. The client's instruction
 * was that a package shows no rupees until a service supplies the rate, and
 * a card with no money on it reads as a missing price — so the page shows a
 * prompt instead and the cards appear only once a service is chosen.
 */
const bare = await fetch(`${SITE}/packages`).then((r) => r.text());

s.check('served', bare.length > 1000, true);
s.check('the prompt stands in for the cards', bare.includes('Choose a service above'), true);
s.check('and no card is rendered', bare.includes(`Web Pack ${stamp}`), false);

s.section('a service picked: the cards and their terms');

const html = await fetch(`${SITE}/packages?service=${target.slug}`).then((r) => r.text());

s.check('the package name renders', html.includes(`Web Pack ${stamp}`), true);
s.check('its sessions render', html.includes('12 paid sessions'), true);
s.check('its free sessions render', html.includes('2 free sessions on top'), true);
s.check('its validity renders', html.includes('Valid for 45 days'), true);
s.check('its percent renders', html.includes('17% off the session rate'), true);

s.check('the admin symbol renders on the card', html.includes('🧪'), true);

// Client, 21 Nov 2026: the card hands the service **and** the package on to
// the trainer search. Dropped, the booking flow re-asks for a service and
// then prices the booking at `Service.basePrice`.
s.check('the card carries the choice forward', html.includes('Choose this package'), true);

s.section('the service picker prices the cards');

// Picked by slug in the URL so the page stays server-rendered: the prices
// come from the API, never from arithmetic in the browser.
const rate = Number(target?.basePrice ?? 0);

s.check("the service carries a rate to price against", rate > 0, true);
s.check('the picker is on the page', html.includes('service-picker'), true);
s.check('no rupee total before a service is picked', bare.includes('for 12 sessions'), false);

// `html` already is the priced page — one fetch, asserted from both angles.
const priced = html;
// 12 sessions at the service rate, less the package's 17%.
const total = Math.round(rate * 12 * 0.83).toLocaleString('en-IN');

s.check('the picked service is named', priced.includes(`Priced for ${target.name}`), true);
s.check('the card carries the worked total', priced.includes(`₹${total}`), true);
s.check('the per-session figure is there', priced.includes('per session'), true);

s.section('the membership design is gone, not reworded');

s.check('no monthly/yearly switch', html.includes('billing-switch'), false);
s.check('no tier comparison', html.includes('Compare membership benefits'), false);
s.check('no membership FAQs', html.includes('Membership FAQs'), false);
s.check('no plan-selection modal', html.includes('Membership selection'), false);
s.check('the old route is gone', (await fetch(`${SITE}/plans`)).status, 404);

s.section('deactivating takes it off the website');

await s.withAdmin(async () => {
  await s.call('PATCH', `/admin/packages/${madeId}/status`, { isActive: false });
});

const after = await s.call('GET', '/packages', undefined, 200, 'none');
s.check(
  'gone from the public list',
  (after?.data ?? []).some((row) => row.id === madeId),
  false,
);

s.section('cleanup');

await s.cleanup(async (db) => {
  await db.package.delete({ where: { id: madeId } });
});

s.done();
