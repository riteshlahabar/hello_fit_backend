/**
 * Admin service rate card — `PATCH /admin/catalog/services/:id/pricing`.
 *
 * Admin sets every price (client, 17 Nov 2026, restated strictly). The point
 * of the suite is the switch: a solo service is pinned to one person, a group
 * service needs room for at least two, and a changed rate shows up in the
 * next customer quote.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const tag = `rate-${Date.now()}`;
const fixture = await s.cleanup(async (db) => {
  const category = await db.serviceCategory.create({
    data: { name: `Cat ${tag}`, slug: `cat-${tag}` },
  });

  const service = await db.service.create({
    data: {
      categoryId: category.id,
      name: `Rate ${tag}`,
      slug: `rate-${tag}`,
      durationMin: 60,
      basePrice: 500,
      allowMultiPerson: false,
      maxParticipants: 1,
    },
  });

  return { category, service };
});

await s.withAdmin(async () => {
  s.section('the rate card');
  const priced = await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { basePrice: 800, durationMin: 45 },
  );
  s.check('rate leaves as a number', priced?.data?.basePrice, 800);
  s.check('duration changed', priced?.data?.durationMin, 45);
  s.check('still a solo service', priced?.data?.allowMultiPerson, false);

  s.section('the two systems stay apart');
  // Head count above one needs the group switch first.
  await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { maxParticipants: 6 },
    400,
  );

  const group = await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { allowMultiPerson: true, maxParticipants: 6 },
  );
  s.check('switched to group', group?.data?.allowMultiPerson, true);
  s.check('ceiling set', group?.data?.maxParticipants, 6);

  // A group service with room for one person could never match a slab.
  await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { allowMultiPerson: true, maxParticipants: 1 },
    400,
  );

  // Switching back pins the ceiling to one, whatever it was.
  const solo = await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { allowMultiPerson: false },
  );
  s.check('ceiling pinned back to one', solo?.data?.maxParticipants, 1);

  s.section('rejections');
  await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { basePrice: -1 },
    400,
  );
  await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { durationMin: 5 },
    400,
  );
  // The provider's own fields are not editable here.
  await s.call(
    'PATCH',
    `/admin/catalog/services/${fixture.service.id}/pricing`,
    { name: 'Renamed by admin' },
    400,
  );
  await s.call(
    'PATCH',
    '/admin/catalog/services/00000000-0000-4000-8000-000000000000/pricing',
    { basePrice: 100 },
    404,
  );
  await s.call(
    'PATCH',
    '/admin/catalog/services/not-a-uuid/pricing',
    { basePrice: 100 },
    400,
  );
});

s.section('the new rate reaches the customer quote');
await s.loginCustomer();
const quote = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.service.id, sessionCount: 2 },
  201,
  'customer',
);
s.check('priced at the admin rate', quote?.data?.grossAmount, 1600);

await s.noToken('PATCH', `/admin/catalog/services/${fixture.service.id}/pricing`, {
  basePrice: 1,
});
await s.call(
  'PATCH',
  `/admin/catalog/services/${fixture.service.id}/pricing`,
  { basePrice: 1 },
  401,
  'customer',
);

await s.cleanup(async (db) => {
  await db.service.delete({ where: { id: fixture.service.id } });
  await db.serviceCategory.delete({ where: { id: fixture.category.id } });
});

s.done();
