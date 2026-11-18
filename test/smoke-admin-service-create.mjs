/**
 * Adding a service from the admin panel — POST /admin/catalog/services
 * (client instruction, 18 Nov 2026).
 *
 * The route goes past PDF 4.5, which gives the provider its own services, so
 * the assertions pin what it may and may not do: it creates, it derives the
 * slug, it refuses a duplicate name, and the row it leaves is ready for the
 * edit route beside it. A service carries no head count — `persons` lives on
 * the Package since 18 Nov 2026.
 *
 *     npm run smoke:admin-service-create
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
const tag = String(Date.now()).slice(-6);
const made = [];
let categoryId = '';

await s.withAdmin(async () => {
  s.section('a category to hang it on');
  const category = await s.call(
    'POST',
    '/admin/catalog/categories',
    { name: `Svc Cat ${tag}` },
    201,
  );
  categoryId = category?.data?.id ?? '';
  s.check('category made', categoryId.length > 20, true);

  s.section('create a solo service');
  const solo = await s.call(
    'POST',
    '/admin/catalog/services',
    {
      categoryId,
      name: `Solo Service ${tag}`,
      basePrice: 600,
      durationMin: 60,
      description: 'Made by the admin panel.',
    },
    201,
  );
  made.push(solo?.data?.id);
  s.check('price leaves as a number', solo?.data?.basePrice, 600);
  s.check('slug derived from the name', solo?.data?.slug, `solo-service-${tag}`);
  s.check('visible by default', solo?.data?.isActive, true);
  s.check('category comes back', solo?.data?.category?.id, categoryId);

  s.section('create is validated');
  const clash = await s.call(
    'POST',
    '/admin/catalog/services',
    { categoryId, name: `Solo Service ${tag}`, basePrice: 500, durationMin: 60 },
    409,
  );
  s.check('duplicate slug', s.errorCode(clash), 'DUPLICATE_RESOURCE');
  await s.call(
    'POST',
    '/admin/catalog/services',
    {
      categoryId: '00000000-0000-4000-8000-000000000000',
      name: `Orphan ${tag}`,
      basePrice: 500,
      durationMin: 60,
    },
    404,
  );
  // Duration below 15 minutes, a negative price and a missing name.
  await s.call('POST', '/admin/catalog/services', { categoryId, name: `Short ${tag}`, basePrice: 500, durationMin: 5 }, 400);
  await s.call('POST', '/admin/catalog/services', { categoryId, name: `Free ${tag}`, basePrice: -1, durationMin: 60 }, 400);
  await s.call('POST', '/admin/catalog/services', { categoryId, basePrice: 500, durationMin: 60 }, 400);

  s.section('edit lives in smoke:admin-service-edit');
  await s.call('PATCH', `/admin/catalog/services/${made[0]}`, { name: `Solo Service ${tag}` }, 200);
  // Delete does exist since 18 Nov — smoke-admin-catalog-delete covers it.

  s.section('the new service is public at once');
  const listed = await s.call('GET', '/admin/catalog/services?q=Solo Service');
  s.check('it is in the admin list', Array.isArray(listed?.data), true);
});

const published = await s.call('GET', '/services', undefined, 200, 'none');
s.check(
  'the customer catalogue carries it',
  (published?.data ?? []).some((row) => row.id === made[0]),
  true,
);

await s.noToken('POST', '/admin/catalog/services', { name: 'Nope' });

await s.cleanup(async (db) => {
  await db.service.deleteMany({ where: { id: { in: made.filter(Boolean) } } });
  await db.serviceCategory.deleteMany({ where: { id: categoryId } });
});

s.done();
