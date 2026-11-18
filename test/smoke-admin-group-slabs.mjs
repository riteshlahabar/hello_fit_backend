/**
 * Admin Group Slab menu — list, create, edit, activate/deactivate.
 *
 * `minPersons` is the row's identity and unique in the database, so the
 * suite works on sizes nothing else uses (180+) and cleans them up after.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

// Far above any real group, so a seeded slab can never collide with these.
const SIZES = [181, 182];
let slab;

await s.cleanup((db) =>
  db.groupSlab.deleteMany({ where: { minPersons: { in: SIZES } } }),
);

await s.withAdmin(async () => {
  s.section('list');
  const listed = await s.call('GET', '/admin/group-slabs');
  s.check('list answers rows', Array.isArray(listed?.data), true);
  // The envelope always carries a meta; an unpaged list leaves it empty.
  s.check('list is not paged', listed?.meta?.total, undefined);

  s.section('create');
  const made = await s.call(
    'POST',
    '/admin/group-slabs',
    { minPersons: SIZES[0], percentOff: 35 },
    201,
  );
  slab = made?.data;
  s.check('percent leaves as a number', slab?.percentOff, 35);
  s.check('active by default', slab?.isActive, true);

  s.section('create is validated');
  const clash = await s.call(
    'POST',
    '/admin/group-slabs',
    { minPersons: SIZES[0], percentOff: 10 },
    409,
  );
  s.check('one row per size', s.errorCode(clash), 'DUPLICATE_RESOURCE');

  // A slab for one person is the base price; over 100% off pays the customer.
  await s.call('POST', '/admin/group-slabs', { minPersons: 1, percentOff: 10 }, 400);
  await s.call(
    'POST',
    '/admin/group-slabs',
    { minPersons: SIZES[1], percentOff: 120 },
    400,
  );
  await s.call('POST', '/admin/group-slabs', { minPersons: SIZES[1] }, 400);

  s.section('edit');
  const edited = await s.call('PATCH', `/admin/group-slabs/${slab.id}`, {
    percentOff: 40,
  });
  s.check('percent changed', edited?.data?.percentOff, 40);
  s.check('size untouched', edited?.data?.minPersons, SIZES[0]);

  // The size is the identity — it is not editable, so sending it is rejected.
  await s.call(
    'PATCH',
    `/admin/group-slabs/${slab.id}`,
    { minPersons: SIZES[1], percentOff: 40 },
    400,
  );
  await s.call(
    'PATCH',
    '/admin/group-slabs/00000000-0000-4000-8000-000000000000',
    { percentOff: 10 },
    404,
  );

  s.section('activate and deactivate');
  const off = await s.call('PATCH', `/admin/group-slabs/${slab.id}/status`, {
    isActive: false,
    reason: 'smoke',
  });
  s.check('went inactive', off?.data?.isActive, false);

  const visible = await s.call('GET', '/admin/group-slabs');
  s.check(
    'inactive row is hidden by default',
    visible?.data?.some((row) => row.id === slab.id),
    false,
  );

  const all = await s.call('GET', '/admin/group-slabs?includeInactive=true');
  s.check(
    'includeInactive finds it',
    all?.data?.some((row) => row.id === slab.id),
    true,
  );

  const on = await s.call('PATCH', `/admin/group-slabs/${slab.id}/status`, {
    isActive: true,
  });
  s.check('back on', on?.data?.isActive, true);

  s.section('a retired size is revived, not refused');
  await s.cleanup((db) =>
    db.groupSlab.update({
      where: { id: slab.id },
      data: { deletedAt: new Date() },
    }),
  );

  const revived = await s.call(
    'POST',
    '/admin/group-slabs',
    { minPersons: SIZES[0], percentOff: 25 },
    201,
  );
  s.check('same row came back', revived?.data?.id, slab.id);
  s.check('with the new percent', revived?.data?.percentOff, 25);

  s.section('delete');
  await s.call('DELETE', `/admin/group-slabs/${slab.id}`, undefined, 200);
  await s.call('DELETE', `/admin/group-slabs/${slab.id}`, undefined, 404);
});

await s.noToken('GET', '/admin/group-slabs');
await s.noToken('POST', '/admin/group-slabs', { minPersons: 3, percentOff: 10 });

// A customer token must not reach an admin menu — the audience guard rejects
// it as a token invalid for this endpoint, before permissions are read.
await s.loginCustomer();
await s.call('GET', '/admin/group-slabs', undefined, 401, 'customer');

await s.cleanup((db) =>
  db.groupSlab.deleteMany({ where: { minPersons: { in: SIZES } } }),
);

s.done();
