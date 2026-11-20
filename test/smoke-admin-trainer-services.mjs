/**
 * The admin Edit dialog's Services multi-select — client, 20-11-2026:
 * "in edit there is option for select branch, give option to select service,
 * show service according to category which is already selected at the time of
 * registration. remove travel buffer and travel radius."
 *
 * Three things a green `npm run build` cannot prove, so they are asserted
 * against a running API:
 *
 *   1. The **list row** carries `instructorServices` and `specialisations` —
 *      the dialog prefills from the row it already has, so a missing include
 *      is an empty selection that silently withdraws every service on save.
 *   2. `serviceIds` is the **whole set**: ids left out are withdrawn, and a
 *      withdrawn service re-selected is revived rather than re-created
 *      (`@@unique([instructorId, serviceId])` would throw on a second row).
 *   3. `travelBufferMin` and `travelRadiusKm` are **gone** from the DTO, which
 *      `forbidNonWhitelisted` turns into a 400.
 *
 *   npm run smoke:admin-trainer-services
 */
import { smoke } from './smoke-harness.mjs';
import { createProvider, removeProvider } from './provider-search-fixture.mjs';

const s = smoke();
const stamp = String(Date.now()).slice(-6);

let made = { userId: '', providerId: '', serviceId: '', categoryId: '', areaId: '', cityId: '' };
let second = '';
let retired = '';

s.section('fixtures: a provider, a second service in their category, a retired one');

await s.cleanup(async (db) => {
  made = await createProvider(db, stamp);

  const extra = await db.service.create({
    data: {
      categoryId: made.categoryId,
      name: `Aerial Silks ${stamp}`,
      slug: `aerial-silks-${stamp}`,
      durationMin: 45,
      basePrice: 700,
      commissionPct: 20,
    },
  });
  second = extra.id;

  const gone = await db.service.create({
    data: {
      categoryId: made.categoryId,
      name: `Aerial Retired ${stamp}`,
      slug: `aerial-retired-${stamp}`,
      durationMin: 45,
      basePrice: 700,
      commissionPct: 20,
      isActive: false,
    },
  });
  retired = gone.id;
});

const PATCH = `/admin/instructors/${made.providerId}`;

/** The list row the Edit dialog is opened from. */
const row = async () => {
  const list = await s.call(
    'GET',
    `/admin/instructors?q=${encodeURIComponent(`Smoke Provider ${stamp}`)}`,
  );
  return (list?.data ?? []).find((r) => r.id === made.providerId);
};

/** Service ids on that row — exactly what the multi-select starts on. */
const chosen = async () =>
  ((await row())?.instructorServices ?? []).map((o) => o.serviceId).sort();

await s.withAdmin(async () => {
  s.section('the list row carries what the dialog needs');

  const found = await row();
  s.check('provider listed', found?.id, made.providerId);
  s.check('services on the row', Array.isArray(found?.instructorServices), true);
  s.check('starts on the fixture service', await chosen(), [made.serviceId]);
  // The dialog narrows the options to these; they are category names.
  s.check('specialisations on the row', found?.specialisations, ['Aerial']);

  s.section('choosing is publishing (PDF 6.5)');

  await s.call('PATCH', PATCH, { serviceIds: [made.serviceId, second] });
  s.check('both chosen', await chosen(), [made.serviceId, second].sort());

  const detail = await s.call('GET', `/admin/instructors/${made.providerId}`);
  s.check(
    'both approved, so the website can show them',
    (detail?.data?.offerings ?? []).filter((o) => o.approvedAt).length,
    2,
  );

  s.section('an id left out is withdrawn');

  await s.call('PATCH', PATCH, { serviceIds: [second] });
  s.check('only the one left', await chosen(), [second]);

  const after = await s.call('GET', `/admin/instructors/${made.providerId}`);
  const dropped = (after?.data?.offerings ?? []).find(
    (o) => o.service.id === made.serviceId,
  );
  s.check('the dropped row survives, unpublished', dropped?.approvedAt, null);
  s.check('and inactive', dropped?.isActive, false);

  s.section('re-selecting revives the row rather than duplicating it');

  await s.call('PATCH', PATCH, { serviceIds: [made.serviceId, second] });
  s.check('both back', await chosen(), [made.serviceId, second].sort());
  s.check(
    'still two offering rows, not three',
    (await s.call('GET', `/admin/instructors/${made.providerId}`))?.data?.offerings
      ?.length,
    2,
  );

  s.section('what the route refuses');

  const bad = await s.call('PATCH', PATCH, { serviceIds: [retired] }, 400);
  s.check('a retired service is refused', s.errorCode(bad) !== undefined, true);
  s.check('and nothing changed', await chosen(), [made.serviceId, second].sort());

  await s.call('PATCH', PATCH, { serviceIds: ['not-a-uuid'] }, 400);

  // Removed from the DTO on 20-11-2026, so `forbidNonWhitelisted` rejects it.
  await s.call('PATCH', PATCH, { travelBufferMin: 45 }, 400);
  await s.call('PATCH', PATCH, { travelRadiusKm: 12 }, 400);

  s.section('clearing the lot leaves the provider off the website');

  await s.call('PATCH', PATCH, { serviceIds: [] });
  s.check('nothing chosen', await chosen(), []);
});

await s.call('GET', `/providers/${made.providerId}`, undefined, 404, 'none');
await s.noToken('PATCH', PATCH, { serviceIds: [] });

await s.cleanup(async (db) => {
  await db.instructorService.deleteMany({ where: { instructorId: made.providerId } });
  await db.service.deleteMany({ where: { id: { in: [second, retired] } } });
  await removeProvider(db, made);
});

s.done();
