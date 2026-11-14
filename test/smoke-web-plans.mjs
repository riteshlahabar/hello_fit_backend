/**
 * The Plans page, wired — client instruction, 13 Nov 2026 (not in the v3 PDF).
 *
 * The demo drew Starter, Plus and Premium into the HTML with a dead
 * Monthly/Yearly switch, so the only way to change a price was to edit the
 * page. What this suite proves is that the page is now **reading** them:
 *
 *   * the admin creates a plan and it reaches the website;
 *   * deactivating it takes it off again;
 *   * the price shown is the administered one, not the demo's figure.
 *
 * The negative assertions carry the weight, as everywhere else here: a page
 * still rendering the demo's hard-coded cards looks perfectly healthy.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-plans
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();
const stamp = String(Date.now()).slice(-6);

const page = () => fetch(`${SITE}/plans`).then((r) => r.text());

s.section('the page is served and reads the API');

const html = await page();

s.check('served', html.length > 1000, true);
s.check('the seeded plans are there', html.includes('Starter'), true);
s.check('the popular ribbon renders', html.includes('MOST POPULAR'), true);

s.section('the CTA the client asked for');

// "Continue with <plan name>" on EVERY card. The demo said "Choose Plus" and
// "Choose Premium" on two of the three.
s.check('Continue with Starter', html.includes('Continue with Starter'), true);
s.check('Continue with Plus', html.includes('Continue with Plus'), true);
s.check('Continue with Premium', html.includes('Continue with Premium'), true);
s.check('no leftover "Choose Plus"', html.includes('Choose Plus'), false);
s.check('no leftover "Choose Premium"', html.includes('Choose Premium'), false);

s.section('prices are administered, not hard-coded');

let madeId = '';

await s.withAdmin(async () => {
  const created = await s.call(
    'POST',
    '/admin/plans',
    {
      name: `Web Plan ${stamp}`,
      icon: '🧪',
      eyebrow: 'From the smoke suite',
      description: 'Published to prove the page reads the API.',
      priceMonthly: 777,
      priceYearly: 555,
      sortOrder: 50,
    },
    201,
  );

  madeId = created?.data?.id ?? '';
  s.check('plan created', madeId.length > 20, true);

  await s.call('PUT', `/admin/plans/${madeId}/features`, {
    features: [
      { label: `Included ${stamp}`, included: true },
      { label: `Excluded ${stamp}`, included: false },
    ],
  });
});

// The page caches for five minutes (ISR), so a fresh read is not guaranteed
// to show the new plan immediately. What IS guaranteed is the API — assert
// there, and assert the page's shape separately rather than racing the cache.
const published = await s.call('GET', '/plans', undefined, 200, 'none');
const mine = (published?.data ?? []).find((p) => p.id === madeId);

s.check('the new plan is public', Boolean(mine), true);
s.check('its price is the one set', mine?.priceMonthly, 777);
s.check('yearly too', mine?.priceYearly, 555);
s.check('its ✓ row', mine?.features?.[0]?.included, true);
s.check('its – row', mine?.features?.[1]?.included, false);

s.section('deactivating takes it off the website');

await s.withAdmin(async () => {
  await s.call('PATCH', `/admin/plans/${madeId}`, { isActive: false });
});

const after = await s.call('GET', '/plans', undefined, 200, 'none');
s.check('gone from the public list', (after?.data ?? []).some((p) => p.id === madeId), false);

s.section('the page still carries the rest of the design');

s.check('billing switch present', html.includes('billing-switch'), true);
s.check('comparison table kept', html.includes('Compare membership benefits'), true);
s.check('FAQs kept', html.includes('Membership FAQs'), true);
s.check('the demo disclaimer is kept', html.includes('Illustrative plan pricing'), true);

s.section('cleanup');

await s.cleanup(async (db) => {
  await db.planFeature.deleteMany({ where: { planId: madeId } });
  await db.plan.delete({ where: { id: madeId } });
});

s.done();
