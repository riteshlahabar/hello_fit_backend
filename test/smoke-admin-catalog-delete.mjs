/**
 * Deleting catalogue rows — DELETE on categories, services and packages
 * (client instruction, 18 Nov 2026).
 *
 * The rule the client set: **hard delete, but refuse when anything points at
 * the row and say what is holding it.** So the refusals carry the weight
 * here — a delete that quietly cascaded would take bookings and invoices
 * with it.
 *
 *     npm run smoke:admin-catalog-delete
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
const tag = String(Date.now()).slice(-6);
const leftovers = {
  services: [],
  categories: [],
  packages: [],
  links: [],
};
let linkedCategoryId = '';

await s.withAdmin(async () => {
  s.section('a category deletes once it is empty');
  const category = await s.call(
    'POST',
    '/admin/catalog/categories',
    { name: `Del Cat ${tag}` },
    201,
  );
  const categoryId = category?.data?.id ?? '';
  leftovers.categories.push(categoryId);

  const service = await s.call(
    'POST',
    '/admin/catalog/services',
    { categoryId, name: `Del Svc ${tag}`, basePrice: 700, durationMin: 60 },
    201,
  );
  const serviceId = service?.data?.id ?? '';
  leftovers.services.push(serviceId);

  // The category is held by its service, and the message has to name it.
  const held = await s.call('DELETE', `/admin/catalog/categories/${categoryId}`, undefined, 409);
  s.check('refused', s.errorCode(held), 'FOREIGN_KEY_VIOLATION');
  s.check('names the holder', held?.error?.message?.includes('1 service'), true);

  await s.call('DELETE', `/admin/catalog/services/${serviceId}`, undefined, 200);
  await s.call('DELETE', `/admin/catalog/categories/${categoryId}`, undefined, 200);
  leftovers.services.pop();
  leftovers.categories.pop();

  s.section('the deleted rows are really gone');
  await s.call('DELETE', `/admin/catalog/services/${serviceId}`, undefined, 404);
  const services = await s.call('GET', '/admin/catalog/services?includeInactive=true&q=Del Svc');
  s.check('not in the list', (services?.data ?? []).length, 0);

  s.section('a service something points at is refused');
  // A trainer link is the cheapest holder to make; a booking or a session
  // refuses by exactly the same path, and the demo data has those on the
  // seeded rows. The refusal must name the holder, not just say no.
  const holder = await s.call(
    'POST',
    '/admin/catalog/categories',
    { name: `Held Cat ${tag}` },
    201,
  );
  linkedCategoryId = holder?.data?.id ?? '';
  leftovers.categories.push(linkedCategoryId);

  const held2 = await s.call(
    'POST',
    '/admin/catalog/services',
    { categoryId: linkedCategoryId, name: `Linked Svc ${tag}`, basePrice: 700, durationMin: 60 },
    201,
  );
  const linkedServiceId = held2?.data?.id ?? '';
  leftovers.services.push(linkedServiceId);

  await s.cleanup(async (db) => {
    const instructor = await db.instructorProfile.findFirst({ select: { id: true } });
    if (!instructor) return;
    const link = await db.instructorService.create({
      data: { instructorId: instructor.id, serviceId: linkedServiceId },
      select: { id: true },
    });
    leftovers.links.push(link.id);
  });

  if (leftovers.links.length > 0) {
    const refused = await s.call(
      'DELETE',
      `/admin/catalog/services/${linkedServiceId}`,
      undefined,
      409,
    );
    s.check('held service refused', s.errorCode(refused), 'FOREIGN_KEY_VIOLATION');
    s.check(
      'the message names the holder',
      /trainer link/.test(refused?.error?.message ?? ''),
      true,
    );
  } else {
    s.check('no trainer in the database to link with', true, true);
  }

  s.section('a package deletes while nothing books it');
  // `serviceIds` is compulsory since 19 Nov 2026, so the fixture sells the
  // package on the service created just above. → state/pricing-rules.md
  const pack = await s.call(
    'POST',
    '/admin/packages',
    {
      name: `Del Pack ${tag}`,
      sessionCount: 4,
      validityDays: 30,
      serviceIds: [linkedServiceId],
    },
    201,
  );
  const packageId = pack?.data?.id ?? '';
  leftovers.packages.push(packageId);

  await s.call('DELETE', `/admin/packages/${packageId}`, undefined, 200);
  leftovers.packages.pop();
  const packs = await s.call('GET', '/admin/packages?includeInactive=true&q=Del Pack');
  s.check('package gone from the list', (packs?.data ?? []).length, 0);
});

s.section('delete needs a token');
await s.noToken('DELETE', '/admin/packages/00000000-0000-4000-8000-000000000000');

await s.cleanup(async (db) => {
  await db.instructorService.deleteMany({ where: { id: { in: leftovers.links } } });
  await db.service.deleteMany({ where: { id: { in: leftovers.services } } });
  await db.serviceCategory.deleteMany({ where: { id: { in: leftovers.categories } } });
  await db.package.deleteMany({ where: { id: { in: leftovers.packages } } });
});

s.done();
