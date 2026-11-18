/**
 * Admin Package menu — list, create, edit, activate/deactivate.
 *
 * A package holds a percent, never a price. Since 18 Nov 2026 it also names
 * the services it is sold on and carries its own `persons` — the pair that
 * replaced Group Slabs. Delete refusals live in smoke-admin-catalog-delete;
 * the teardown still goes through Prisma.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const tag = `pkg-${Date.now()}`;
let created;

await s.withAdmin(async () => {
  s.section('list');
  const listed = await s.call('GET', '/admin/packages?limit=5');
  s.check('list answers rows', Array.isArray(listed?.data), true);
  s.check('list carries paging', typeof listed?.meta?.total, 'number');

  s.section('create');
  const made = await s.call(
    'POST',
    '/admin/packages',
    {
      name: `Monthly ${tag}`,
      icon: '🔥',
      sessionCount: 12,
      validityDays: 30,
      percentAdjust: -15,
      sortOrder: 3,
    },
    201,
  );
  created = made?.data;
  s.check('percent leaves as a number', created?.percentAdjust, -15);
  s.check('icon stored', created?.icon, '🔥');
  s.check('free sessions default to none', created?.freeSessionCount, 0);
  s.check('weekdays default to any', created?.allowedWeekdays, []);

  const trial = await s.call(
    'POST',
    '/admin/packages',
    {
      name: `Trial ${tag}`,
      sessionCount: 1,
      validityDays: 7,
      percentAdjust: 20,
      freeSessionCount: 1,
    },
    201,
  );
  s.check('trial keeps its free session', trial?.data?.freeSessionCount, 1);

  s.section('create is validated');
  // Same name twice is a support call waiting to happen.
  const clash = await s.call(
    'POST',
    '/admin/packages',
    { name: `monthly ${tag}`, sessionCount: 4, validityDays: 30 },
    409,
  );
  s.check('duplicate name', s.errorCode(clash), 'DUPLICATE_RESOURCE');

  // Below -100% the booking would owe the customer money.
  await s.call(
    'POST',
    '/admin/packages',
    { name: `Bad ${tag}`, sessionCount: 4, validityDays: 30, percentAdjust: -120 },
    400,
  );
  await s.call(
    'POST',
    '/admin/packages',
    { name: `Bad ${tag}`, sessionCount: 0, validityDays: 30 },
    400,
  );
  await s.call(
    'POST',
    '/admin/packages',
    { name: `Bad ${tag}`, sessionCount: 4, validityDays: 30, allowedWeekdays: [9] },
    400,
  );
  // No price field exists any more; whitelisting must reject it.
  await s.call(
    'POST',
    '/admin/packages',
    { name: `Priced ${tag}`, sessionCount: 4, validityDays: 30, price: 4000 },
    400,
  );

  s.section('services and persons');
  // A package names the services it is sold on and carries its own head
  // count (client, 18 Nov 2026) — that pair replaced Group Slabs.
  const services = await s.call('GET', '/admin/catalog/services?limit=2');
  const ids = (services?.data ?? []).map((row) => row.id);
  s.check('two services to tick', ids.length >= 1, true);

  const group = await s.call(
    'POST',
    '/admin/packages',
    {
      name: `Group ${tag}`,
      sessionCount: 24,
      persons: 3,
      validityDays: 30,
      percentAdjust: -20,
      serviceIds: ids,
    },
    201,
  );
  s.check('head count stored', group?.data?.persons, 3);
  s.check('services came back', group?.data?.services?.length, ids.length);

  // The list replaces wholesale: a multi-select cannot say "drop just one".
  const narrowed = await s.call('PATCH', `/admin/packages/${group.data.id}`, {
    serviceIds: [ids[0]],
  });
  s.check('list replaced, not merged', narrowed?.data?.services?.length, 1);

  const unsold = await s.call('PATCH', `/admin/packages/${group.data.id}`, {
    serviceIds: [],
  });
  s.check('empty list unsells it everywhere', unsold?.data?.services?.length, 0);

  // A package the customer cannot see is still a valid admin row, but a
  // service that does not exist is not.
  await s.call(
    'PATCH',
    `/admin/packages/${group.data.id}`,
    { serviceIds: ['00000000-0000-4000-8000-000000000000'] },
    404,
  );
  await s.call(
    'POST',
    '/admin/packages',
    { name: `BadP ${tag}`, sessionCount: 4, validityDays: 30, persons: 0 },
    400,
  );

  s.section('edit');
  const edited = await s.call('PATCH', `/admin/packages/${created.id}`, {
    percentAdjust: -20,
    allowedWeekdays: [1, 3, 5],
  });
  s.check('percent changed', edited?.data?.percentAdjust, -20);
  s.check('weekdays changed', edited?.data?.allowedWeekdays, [1, 3, 5]);
  s.check('name untouched', edited?.data?.name, `Monthly ${tag}`);
  s.check('icon untouched by an absent field', edited?.data?.icon, '🔥');

  // Empty string is the admin clearing the symbol — the card then draws its
  // own mark. Anything longer than 16 characters is not a symbol.
  const cleared = await s.call('PATCH', `/admin/packages/${created.id}`, {
    icon: '',
  });
  s.check('empty icon clears to null', cleared?.data?.icon, null);
  await s.call(
    'PATCH',
    `/admin/packages/${created.id}`,
    { icon: 'x'.repeat(17) },
    400,
  );

  await s.call(
    'PATCH',
    `/admin/packages/${created.id}`,
    { name: `Trial ${tag}` },
    409,
  );
  await s.call(
    'PATCH',
    '/admin/packages/00000000-0000-4000-8000-000000000000',
    { sortOrder: 1 },
    404,
  );

  s.section('activate and deactivate');
  const off = await s.call('PATCH', `/admin/packages/${created.id}/status`, {
    isActive: false,
    reason: 'smoke',
  });
  s.check('went inactive', off?.data?.isActive, false);
  s.check('booking count reported', typeof off?.data?.bookings, 'number');

  const hidden = await s.call('GET', `/admin/packages?q=Monthly ${tag}`);
  s.check('inactive row is hidden by default', hidden?.data?.length, 0);

  const shown = await s.call(
    'GET',
    `/admin/packages?q=Monthly ${tag}&includeInactive=true`,
  );
  s.check('includeInactive finds it', shown?.data?.length, 1);

  const on = await s.call('PATCH', `/admin/packages/${created.id}/status`, {
    isActive: true,
  });
  s.check('back on', on?.data?.isActive, true);

  s.section('delete');
  await s.call('DELETE', `/admin/packages/${created.id}`, undefined, 200);
  await s.call('DELETE', `/admin/packages/${created.id}`, undefined, 404);
});

await s.noToken('GET', '/admin/packages');
await s.noToken('POST', '/admin/packages', {
  name: 'x',
  sessionCount: 1,
  validityDays: 1,
});

// A customer token must not reach an admin menu.
await s.loginCustomer();
await s.call('GET', '/admin/packages', undefined, 401, 'customer');

await s.cleanup((db) =>
  db.package.deleteMany({ where: { name: { contains: tag } } }),
);

s.done();
