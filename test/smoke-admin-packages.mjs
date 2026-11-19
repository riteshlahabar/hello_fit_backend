/**
 * Admin Package menu — list, create, edit, activate/deactivate.
 *
 * A package holds a percent, never a price. Since 18 Nov 2026 it also names
 * the services it is sold on and carries its own `persons` — the pair that
 * replaced Group Slabs. **Since 19 Nov 2026 `serviceIds` is compulsory with
 * at least one id**, so every create below ticks a service and the old "empty
 * list unsells it everywhere" case is now a refusal. Delete refusals live in
 * smoke-admin-catalog-delete; the teardown still goes through Prisma.
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

  // Read first: a package cannot be created without a service to sell it on.
  const services = await s.call('GET', '/admin/catalog/services?limit=2');
  const ids = (services?.data ?? []).map((row) => row.id);
  s.check('a service to tick', ids.length >= 1, true);
  const one = [ids[0]];

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
      serviceIds: one,
    },
    201,
  );
  created = made?.data;
  s.check('percent leaves as a number', created?.percentAdjust, -15);
  s.check('icon stored', created?.icon, '🔥');
  s.check('free sessions default to none', created?.freeSessionCount, 0);
  s.check('weekdays default to any', created?.allowedWeekdays, []);
  s.check('service linked', created?.services?.length, 1);

  const trial = await s.call(
    'POST',
    '/admin/packages',
    {
      name: `Trial ${tag}`,
      sessionCount: 1,
      validityDays: 7,
      percentAdjust: 20,
      freeSessionCount: 1,
      serviceIds: one,
    },
    201,
  );
  s.check('trial keeps its free session', trial?.data?.freeSessionCount, 1);

  s.section('create is validated');
  // Same name twice is a support call waiting to happen. Valid body
  // otherwise, or the ValidationPipe would answer 400 before the name check.
  const clash = await s.call(
    'POST',
    '/admin/packages',
    { name: `monthly ${tag}`, sessionCount: 4, validityDays: 30, serviceIds: one },
    409,
  );
  s.check('duplicate name', s.errorCode(clash), 'DUPLICATE_RESOURCE');

  // One field wrong per body, each the only thing that makes it a 400.
  const base = { name: `Bad ${tag}`, sessionCount: 4, validityDays: 30, serviceIds: one };
  const refused = [
    // Below -100% the booking would owe the customer money.
    { ...base, percentAdjust: -120 },
    { ...base, sessionCount: 0 },
    { ...base, persons: 0 },
    { ...base, allowedWeekdays: [9] },
    // No price field exists any more; whitelisting must reject it.
    { ...base, price: 4000 },
    // Services are compulsory (client, 19 Nov 2026) — absent and empty both.
    { ...base, serviceIds: undefined },
    { ...base, serviceIds: [] },
  ];
  for (const body of refused) {
    await s.call('POST', '/admin/packages', body, 400);
  }

  s.section('services and persons');
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
    serviceIds: one,
  });
  s.check('list replaced, not merged', narrowed?.data?.services?.length, 1);

  // Unselling everywhere is what deactivating is for, so `[]` is refused and
  // the links it would have dropped are still there.
  await s.call('PATCH', `/admin/packages/${group.data.id}`, { serviceIds: [] }, 400);
  // No GET :id on this menu — the list is where a row is read back.
  const kept = await s.call('GET', `/admin/packages?q=Group ${tag}`);
  s.check('refused patch left the link alone', kept?.data?.[0]?.services?.length, 1);

  // A service that does not exist is a 404, not a validation error.
  await s.call(
    'PATCH',
    `/admin/packages/${group.data.id}`,
    { serviceIds: ['00000000-0000-4000-8000-000000000000'] },
    404,
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
  s.check('services untouched by an absent field', edited?.data?.services?.length, 1);

  // Empty string is the admin clearing the symbol — the card then draws its
  // own mark. Anything longer than 16 characters is not a symbol.
  const cleared = await s.call('PATCH', `/admin/packages/${created.id}`, {
    icon: '',
  });
  s.check('empty icon clears to null', cleared?.data?.icon, null);

  // A symbol longer than 16 characters is not a symbol; the other name is
  // taken; the id does not exist.
  const edits = [
    [created.id, { icon: 'x'.repeat(17) }, 400],
    [created.id, { name: `Trial ${tag}` }, 409],
    ['00000000-0000-4000-8000-000000000000', { sortOrder: 1 }, 404],
  ];
  for (const [id, body, status] of edits) {
    await s.call('PATCH', `/admin/packages/${id}`, body, status);
  }

  s.section('activate and deactivate');
  const status = (isActive, reason) =>
    s.call('PATCH', `/admin/packages/${created.id}/status`, { isActive, reason });

  const off = await status(false, 'smoke');
  s.check('went inactive', off?.data?.isActive, false);
  s.check('booking count reported', typeof off?.data?.bookings, 'number');

  const hidden = await s.call('GET', `/admin/packages?q=Monthly ${tag}`);
  s.check('inactive row is hidden by default', hidden?.data?.length, 0);
  const shown = await s.call(
    'GET',
    `/admin/packages?q=Monthly ${tag}&includeInactive=true`,
  );
  s.check('includeInactive finds it', shown?.data?.length, 1);
  s.check('back on', (await status(true))?.data?.isActive, true);

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
