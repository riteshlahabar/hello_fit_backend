/**
 * Admin Trainer Category menu — the Basic / Standard / Premium / Elite bands.
 *
 * A band carries no price. It selects a commission rule, so the suite's
 * point is the refusal: a band with providers or rules behind it cannot be
 * retired until they are moved.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const tag = `band-${Date.now()}`;
let band;

await s.withAdmin(async () => {
  s.section('list');
  const listed = await s.call('GET', '/admin/trainer-categories');
  s.check('list answers rows', Array.isArray(listed?.data), true);

  s.section('create');
  const made = await s.call(
    'POST',
    '/admin/trainer-categories',
    { name: `Premium ${tag}`, sortOrder: 2 },
    201,
  );
  band = made?.data;
  s.check('active by default', band?.isActive, true);
  s.check('no provider in it yet', band?._count?.instructors, undefined);

  s.section('create is validated');
  const clash = await s.call(
    'POST',
    '/admin/trainer-categories',
    { name: `premium ${tag}` },
    409,
  );
  s.check('one band per name', s.errorCode(clash), 'DUPLICATE_RESOURCE');

  await s.call('POST', '/admin/trainer-categories', { name: 'x' }, 400);
  await s.call(
    'POST',
    '/admin/trainer-categories',
    { name: `Other ${tag}`, sortOrder: -1 },
    400,
  );

  s.section('edit');
  const edited = await s.call('PATCH', `/admin/trainer-categories/${band.id}`, {
    sortOrder: 5,
  });
  s.check('sort changed', edited?.data?.sortOrder, 5);
  s.check('name untouched', edited?.data?.name, `Premium ${tag}`);

  await s.call(
    'PATCH',
    '/admin/trainer-categories/00000000-0000-4000-8000-000000000000',
    { sortOrder: 1 },
    404,
  );

  s.section('an empty band retires and comes back');
  const off = await s.call(
    'PATCH',
    `/admin/trainer-categories/${band.id}/status`,
    { isActive: false, reason: 'smoke' },
  );
  s.check('went inactive', off?.data?.isActive, false);

  const visible = await s.call('GET', '/admin/trainer-categories');
  s.check(
    'inactive row is hidden by default',
    visible?.data?.some((row) => row.id === band.id),
    false,
  );

  const all = await s.call(
    'GET',
    '/admin/trainer-categories?includeInactive=true',
  );
  s.check(
    'includeInactive finds it',
    all?.data?.some((row) => row.id === band.id),
    true,
  );

  await s.call('PATCH', `/admin/trainer-categories/${band.id}/status`, {
    isActive: true,
  });

  s.section('a band with a rule behind it will not retire');
  await s.cleanup((db) =>
    db.commissionRule.create({
      data: {
        scope: 'TRAINER_CATEGORY',
        trainerCategoryId: band.id,
        value: 20,
        effectiveFrom: new Date(),
      },
    }),
  );

  const refused = await s.call(
    'PATCH',
    `/admin/trainer-categories/${band.id}/status`,
    { isActive: false },
    409,
  );
  s.check('refused while in use', s.errorCode(refused), 'MASTER_IN_USE');
  s.check(
    'the refusal names the count',
    /1 commission rule/.test(refused?.error?.message ?? ''),
    true,
  );

  await s.cleanup((db) =>
    db.commissionRule.deleteMany({ where: { trainerCategoryId: band.id } }),
  );

  const nowOff = await s.call(
    'PATCH',
    `/admin/trainer-categories/${band.id}/status`,
    { isActive: false },
  );
  s.check('retires once the rule is gone', nowOff?.data?.isActive, false);

  s.section('no delete route');
  await s.call('DELETE', `/admin/trainer-categories/${band.id}`, undefined, 404);
});

await s.noToken('GET', '/admin/trainer-categories');
await s.noToken('POST', '/admin/trainer-categories', { name: 'x y' });

// A customer token must not reach an admin menu — the audience guard rejects
// it as a token invalid for this endpoint, before permissions are read.
await s.loginCustomer();
await s.call('GET', '/admin/trainer-categories', undefined, 401, 'customer');

await s.cleanup((db) =>
  db.trainerCategory.deleteMany({ where: { name: { contains: tag } } }),
);

s.done();
