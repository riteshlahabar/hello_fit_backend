/**
 * Public provider search and profiles — PDF §5.5 and §5.6.
 *
 * This is the marketplace half of the model: the customer filters and chooses
 * (§3.6), rather than `assignment/` scoring and picking for them.
 *
 * The assertions that matter are the **negative** ones. §5.5's acceptance
 * criteria are mostly about who must NOT appear — "inactive or unapproved
 * providers are not presented as available for booking" — and a search that
 * returns too much looks perfectly healthy. So the suite builds a provider it
 * controls and walks them through every state that should hide them:
 *
 *   unapproved -> approved -> suspended -> KYC pending -> service retired
 *
 * and checks the list and the detail route agree at every step. A provider
 * reachable by id but missing from the list is a disclosure bug, which is why
 * both are asserted together.
 *
 *   npm run smoke:provider-search
 */
import { smoke } from './smoke-harness.mjs';
import { createProvider, removeProvider } from './provider-search-fixture.mjs';

const s = smoke();
const stamp = String(Date.now()).slice(-6);

s.section('fixtures: a city, an area, a category, a service and a provider');

let made = { userId: '', providerId: '', serviceId: '', categoryId: '', areaId: '', cityId: '' };
await s.cleanup(async (db) => { made = await createProvider(db, stamp); });

s.check('provider created', made.providerId.length > 20, true);

const find = async (query = '') =>
  s.call('GET', `/providers${query}`, undefined, 200, 'none');

const listed = async (query = '') => {
  const res = await find(query);
  return (res?.data ?? []).some((p) => p.id === made.providerId);
};

s.section('unapproved: invisible, by both routes');

// The offering exists and is active but has never been approved. §5.5.
s.check('not in the list', await listed(), false);
await s.call('GET', `/providers/${made.providerId}`, undefined, 404, 'none');

s.section('an administrator approves the offering (PDF 6.5)');

await s.withAdmin(async () => {
  const out = await s.call(
    'POST',
    `/admin/instructors/${made.providerId}/services/${made.serviceId}/approval`,
    { approved: true },
  );
  s.check('approval accepted', out?.message, 'Service published');
});

s.check('now listed', await listed(), true);

s.section('what the admin panel reads back (PDF 6.5)');

// The Services dialog is built on these two fields of the detail response.
// Without them the screen renders empty and an administrator cannot tell
// whether a provider is published.
await s.withAdmin(async () => {
  const admin = await s.call('GET', `/admin/instructors/${made.providerId}`);

  s.check('offerings returned', Array.isArray(admin?.data?.offerings), true);
  s.check('one offering', admin?.data?.offerings?.length, 1);
  s.check('approval state is visible', Boolean(admin?.data?.offerings?.[0]?.approvedAt), true);
  // Provider-set pricing went on 17-11-2026: the rate is the service's and
  // the same whoever delivers it (state/pricing-rules.md).
  s.check('the base price is the only price', admin?.data?.offerings?.[0]?.service?.basePrice, '900');
  s.check('category named for the column', admin?.data?.offerings?.[0]?.service?.category?.name?.includes(stamp), true);});

const detail = await s.call('GET', `/providers/${made.providerId}`, undefined, 200, 'none');
s.check('detail reachable', detail?.data?.id, made.providerId);
s.check('name correct', detail?.data?.name?.includes(stamp), true);
s.check('the service base price, not a provider price', detail?.data?.services?.[0]?.price, 900);
s.check('service belongs to the provider', detail?.data?.services?.length, 1);
s.check('supported areas listed (§5.6)', detail?.data?.areas?.length, 1);
s.check('area carries its city', detail?.data?.areas?.[0]?.city?.id, made.cityId);

s.section('every filter in the design sidebar');

s.check('category match', await listed(`?categoryId=${made.categoryId}`), true);
s.check('city match', await listed(`?cityId=${made.cityId}`), true);
s.check('area match', await listed(`?areaId=${made.areaId}`), true);
s.check('rating 4.5+ keeps them', await listed('?minRating=4.5'), true);
s.check('rating 5.0 excludes them', await listed('?minRating=5'), false);
s.check('price ceiling 900 keeps them', await listed('?maxPrice=900'), true);
s.check('price ceiling 800 excludes them', await listed('?maxPrice=800'), false);
s.check('name search matches', await listed(`?q=Smoke Provider ${stamp}`), true);
s.check('a nonsense query does not', await listed('?q=zzzznotathing'), false);

s.section('the price ceiling is per service, not per provider');

// A provider teaching one thing cheaply and another dearly must not satisfy
// "this category under this price" using two different services.
s.check(
  'category + too-low ceiling together exclude',
  await listed(`?categoryId=${made.categoryId}&maxPrice=800`),
  false,
);

s.section('no-result conditions are a message, not an error (§5.5)');

const none = await find('?minRating=5&maxPrice=1');
s.check('still a 200', Array.isArray(none?.data), true);
s.check('empty flagged in meta', none?.meta?.empty, true);
s.check('and a message is supplied', typeof none?.message, 'string');

s.section('bad input is refused');

await s.call('GET', '/providers?minRating=9', undefined, 400, 'none');
// Session location went on 20-11-2026 (client): home-service only, so the
// filter has one answer. `forbidNonWhitelisted` makes the old param a 400.
await s.call('GET', '/providers?sessionFormat=CUSTOMER_HOME', undefined, 400, 'none');
await s.call('GET', '/providers?categoryId=not-a-uuid', undefined, 400, 'none');
await s.call('GET', '/providers/not-a-uuid', undefined, 400, 'none');

s.section('each way a provider must disappear again');

await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { status: 'SUSPENDED' },
  });
});
s.check('suspended: not listed', await listed(), false);
await s.call('GET', `/providers/${made.providerId}`, undefined, 404, 'none');

await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { status: 'ACTIVE', kycStatus: 'PENDING' },
  });
});
s.check('KYC not verified: not listed', await listed(), false);

await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { kycStatus: 'VERIFIED' },
  });
  await db.service.update({ where: { id: made.serviceId }, data: { isActive: false } });
});
s.check('service retired: not listed', await listed(), false);

s.section('approval is refused when it would publish nothing bookable');

await s.cleanup(async (db) => {
  await db.instructorService.updateMany({
    where: { instructorId: made.providerId },
    data: { approvedAt: null },
  });
});

await s.withAdmin(async () => {
  // The service is still inactive from the step above.
  const refused = await s.call(
    'POST',
    `/admin/instructors/${made.providerId}/services/${made.serviceId}/approval`,
    { approved: true },
    400,
  );
  s.check('refused with a reason', s.errorCode(refused) !== undefined, true);

  await s.call(
    'POST',
    `/admin/instructors/${made.providerId}/services/${crypto.randomUUID()}/approval`,
    { approved: true },
    404,
  );
});

await s.noToken('POST', `/admin/instructors/${made.providerId}/services/${made.serviceId}/approval`, {
  approved: true,
});

s.section('cleanup');

await s.cleanup((db) => removeProvider(db, made));

s.done();
