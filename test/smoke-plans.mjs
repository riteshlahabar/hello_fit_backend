/**
 * Membership plans — client instruction, 13 Nov 2026 (not in the v3 PDF).
 *
 * Two things are worth asserting hard here, because both are easy to get
 * wrong and neither shows up in a build:
 *
 *   1. **Prices must leave as numbers.** A Prisma `Decimal` serialises to
 *      `{"s":1,"e":2,"d":[499]}` and the website renders that as
 *      `[object Object]`. The view layer converts; this proves it.
 *   2. **At most one plan may be "most popular".** The schema cannot say it,
 *      so the service clears the others — and this walks the ribbon from one
 *      plan to another and checks the first one let go.
 *
 *   npm run smoke:plans
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
const stamp = String(Date.now()).slice(-6);

s.section('the public list (no token)');

const published = await s.call('GET', '/plans', undefined, 200, 'none');
const plans = published?.data ?? [];

s.check('plans are published', plans.length >= 3, true);
s.check('the seeded Starter is there', plans.some((p) => p.slug === 'starter'), true);

const plus = plans.find((p) => p.slug === 'plus');
// Not "Plus is the popular one": this suite moves the ribbon onto its own
// plan further down, so asserting a particular holder makes the suite pass
// only on a fresh database. The invariant is what matters — at most one.
s.check('at most one popular plan', plans.filter((p) => p.isPopular).length <= 1, true);
s.check('price is a number, not a Decimal', typeof plus?.priceMonthly, 'number');
s.check('and it is the design figure', plus?.priceMonthly, 499);
s.check('yearly price too', plus?.priceYearly, 399);
s.check('features came with it', plus?.features?.length, 6);
s.check('an excluded feature is marked', plus?.features?.some((f) => !f.included), true);
s.check('cards are ordered', plans[0]?.slug, 'starter');

s.section('an administrator creates one');

let madeId = '';

await s.withAdmin(async () => {
  // 201, like every other admin create in this API.
  const created = await s.call('POST', '/admin/plans', {
    name: `Smoke Plan ${stamp}`,
    icon: '🧪',
    description: 'Created by the smoke suite.',
    priceMonthly: 250.5,
    priceYearly: 200,
    sortOrder: 9,
  }, 201);

  madeId = created?.data?.id ?? '';
  s.check('created', madeId.length > 20, true);
  s.check('slug derived from the name', created?.data?.slug?.startsWith('smoke-plan'), true);
  s.check('decimal price survives', created?.data?.priceMonthly, 250.5);
  s.check('no features yet', created?.data?.featureCount, 0);
  s.check('nobody has chosen it', created?.data?.customerCount, 0);

  s.section('the ✓/– feature dialog replaces the whole list');

  const withFeatures = await s.call('PUT', `/admin/plans/${madeId}/features`, {
    features: [
      { label: 'Included thing', included: true },
      { label: 'Excluded thing', included: false },
    ],
  });

  s.check('two features', withFeatures?.data?.featureCount, 2);
  s.check('order is preserved', withFeatures?.data?.features?.[0]?.label, 'Included thing');
  s.check('the – row is kept as excluded', withFeatures?.data?.features?.[1]?.included, false);

  // Replacing with fewer must delete, not merge — otherwise an administrator
  // can never shorten a card.
  const shortened = await s.call('PUT', `/admin/plans/${madeId}/features`, {
    features: [{ label: 'Only thing' }],
  });
  s.check('replacing shortens the list', shortened?.data?.featureCount, 1);
  s.check('and defaults to included', shortened?.data?.features?.[0]?.included, true);

  s.section('only one plan may wear the MOST POPULAR ribbon');

  const promoted = await s.call('PATCH', `/admin/plans/${madeId}`, { isPopular: true });
  s.check('the new plan is popular', promoted?.data?.isPopular, true);

  const after = await s.call('GET', '/admin/plans');
  const popular = (after?.data ?? []).filter((p) => p.isPopular);
  s.check('exactly one popular plan', popular.length, 1);
  s.check('and it is the new one', popular[0]?.id, madeId);

  s.section('the active filter');

  await s.call('PATCH', `/admin/plans/${madeId}`, { isActive: false });

  const activeOnly = await s.call('GET', '/admin/plans?isActive=true');
  s.check('deactivated plan is filtered out', (activeOnly?.data ?? []).some((p) => p.id === madeId), false);

  const inactiveOnly = await s.call('GET', '/admin/plans?isActive=false');
  s.check('and found by the other side', (inactiveOnly?.data ?? []).some((p) => p.id === madeId), true);
});

s.section('an inactive plan is off the website entirely');

const afterHiding = await s.call('GET', '/plans', undefined, 200, 'none');
s.check('not in the public list', (afterHiding?.data ?? []).some((p) => p.id === madeId), false);

s.section('choosing a plan — the website CTA');

await s.loginCustomer();

const chosen = await s.call(
  'POST',
  `/plans/${plus.id}/choose`,
  {},
  200,
  'customer',
);
s.check('choice accepted', chosen?.data?.slug, 'plus');
s.check('and named in the message', chosen?.message?.includes('Plus'), true);

const mine = await s.call('GET', '/plans/mine', undefined, 200, 'customer');
s.check('it reads back', mine?.data?.slug, 'plus');
s.check('with its price', typeof mine?.data?.priceMonthly, 'number');

// An inactive plan is not on the website, so a request naming one did not come
// from a card anybody saw.
await s.call('POST', `/plans/${madeId}/choose`, {}, 400, 'customer');

s.section('what must not be reachable');

await s.noToken('GET', '/admin/plans');
await s.call('POST', `/plans/${plus.id}/choose`, {}, 401, 'none');
await s.call('GET', '/plans/mine', undefined, 401, 'none');
await s.call('GET', '/plans/not-a-uuid/choose', undefined, 404, 'none');

s.section('cleanup');

await s.cleanup(async (db) => {
  await db.customerProfile.updateMany({ where: { planId: plus.id }, data: { planId: null } });
  // The ribbon was moved onto the smoke plan, which clears it everywhere else.
  // Put the seed's back, or the next run starts with no popular plan.
  await db.plan.update({ where: { id: plus.id }, data: { isPopular: true } });
  await db.planFeature.deleteMany({ where: { planId: madeId } });
  await db.plan.delete({ where: { id: madeId } });
});

s.done();
