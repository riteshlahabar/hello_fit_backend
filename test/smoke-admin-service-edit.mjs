/**
 * Editing a service from the admin panel — PATCH /admin/catalog/services/:id
 * (client instruction, 18 Nov 2026).
 *
 * Past PDF 4.5 on purpose, like the create route. The assertions pin what the
 * edit may do: rename and re-slug, move category, change the rate, and flip
 * `allowMultiPerson` — the switch that decides package versus slab pricing
 * and had no admin control before this route.
 *
 *     npm run smoke:admin-service-edit
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
const tag = String(Date.now()).slice(-6);
const made = [];
const categories = [];

await s.withAdmin(async () => {
  s.section('two categories and a service');
  for (const name of [`Edit Cat A ${tag}`, `Edit Cat B ${tag}`]) {
    const row = await s.call('POST', '/admin/catalog/categories', { name }, 201);
    categories.push(row?.data?.id ?? '');
  }
  s.check('both categories made', categories.every((id) => id.length > 20), true);

  const created = await s.call(
    'POST',
    '/admin/catalog/services',
    {
      categoryId: categories[0],
      name: `Edit Me ${tag}`,
      basePrice: 600,
      durationMin: 60,
    },
    201,
  );
  const id = created?.data?.id ?? '';
  made.push(id);

  s.section('rename moves the slug with it');
  const renamed = await s.call('PATCH', `/admin/catalog/services/${id}`, {
    name: `Edited ${tag}`,
    description: 'Changed by the admin panel.',
  });
  s.check('name changed', renamed?.data?.name, `Edited ${tag}`);
  s.check('slug followed', renamed?.data?.slug, `edited-${tag}`);
  s.check('description changed', renamed?.data?.description, 'Changed by the admin panel.');
  s.check('untouched field kept', renamed?.data?.basePrice, 600);

  s.section('category, rate and visibility');
  const moved = await s.call('PATCH', `/admin/catalog/services/${id}`, {
    categoryId: categories[1],
    basePrice: 850,
    durationMin: 90,
    isActive: false,
  });
  s.check('category moved', moved?.data?.categoryId, categories[1]);
  s.check('rate changed', moved?.data?.basePrice, 850);
  s.check('duration changed', moved?.data?.durationMin, 90);
  s.check('hidden', moved?.data?.isActive, false);

  s.section('allowMultiPerson can be flipped');
  const group = await s.call('PATCH', `/admin/catalog/services/${id}`, {
    allowMultiPerson: true,
    maxParticipants: 8,
  });
  s.check('now a group service', group?.data?.allowMultiPerson, true);
  s.check('group size kept', group?.data?.maxParticipants, 8);

  const solo = await s.call('PATCH', `/admin/catalog/services/${id}`, {
    allowMultiPerson: false,
  });
  s.check('back to solo', solo?.data?.allowMultiPerson, false);
  s.check('ceiling follows the switch', solo?.data?.maxParticipants, 1);

  s.section('the two pricing systems stay apart');
  await s.call('PATCH', `/admin/catalog/services/${id}`, { maxParticipants: 6 }, 400);
  await s.call(
    'PATCH',
    `/admin/catalog/services/${id}`,
    { allowMultiPerson: true, maxParticipants: 1 },
    400,
  );

  s.section('edit is validated');
  const other = await s.call(
    'POST',
    '/admin/catalog/services',
    { categoryId: categories[0], name: `Neighbour ${tag}`, basePrice: 400, durationMin: 60 },
    201,
  );
  made.push(other?.data?.id);
  const clash = await s.call(
    'PATCH',
    `/admin/catalog/services/${id}`,
    { name: `Neighbour ${tag}` },
    409,
  );
  s.check('duplicate slug refused', s.errorCode(clash), 'DUPLICATE_RESOURCE');
  // Its own name is not a clash with itself.
  await s.call('PATCH', `/admin/catalog/services/${id}`, { name: `Edited ${tag}` }, 200);
  await s.call(
    'PATCH',
    `/admin/catalog/services/${id}`,
    { categoryId: '00000000-0000-4000-8000-000000000000' },
    404,
  );
  await s.call('PATCH', `/admin/catalog/services/${id}`, { durationMin: 5 }, 400);
  await s.call('PATCH', `/admin/catalog/services/${id}`, { basePrice: -1 }, 400);
  await s.call(
    'PATCH',
    '/admin/catalog/services/00000000-0000-4000-8000-000000000000',
    { name: `Ghost ${tag}` },
    404,
  );
});

await s.noToken('PATCH', `/admin/catalog/services/${made[0]}`, { name: 'Nope' });

await s.cleanup(async (db) => {
  await db.service.deleteMany({ where: { id: { in: made.filter(Boolean) } } });
  await db.serviceCategory.deleteMany({ where: { id: { in: categories.filter(Boolean) } } });
});

s.done();
