/**
 * Commission as a percent (client, 19-11-2026). Trainer Category bands are
 * gone; a service now states the trainer's cut and a provider may carry an
 * override that beats it.
 *
 * Run: `npm run smoke:commission`.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
await s.withAdmin(async () => {

const stamp = Date.now();
const categories = await s.call('GET', '/admin/catalog/categories?limit=1', undefined, 200);
const categoryId = categories?.data?.[0]?.id;
s.check('a category exists to hang a service on', typeof categoryId, 'string');

s.section('commissionPct is compulsory on create');
const base = {
  categoryId,
  name: `Commission Smoke ${stamp}`,
  basePrice: 1000,
  durationMin: 60,
};
const missing = await s.call('POST', '/admin/catalog/services', base, 400);
s.check('absent percent refused', s.errorCode(missing), 'VALIDATION_FAILED');

for (const [label, value] of [
  ['negative', -1],
  ['over 100', 101],
  ['not a number', 'twenty'],
  ['three decimals', 25.555],
]) {
  const res = await s.call(
    'POST',
    '/admin/catalog/services',
    { ...base, commissionPct: value },
    400,
  );
  s.check(`${label} percent refused`, s.errorCode(res), 'VALIDATION_FAILED');
}

s.section('a good percent round-trips');
const created = await s.call(
  'POST',
  '/admin/catalog/services',
  { ...base, commissionPct: 30 },
  201,
);
const serviceId = created?.data?.id;
s.check('percent stored', Number(created?.data?.commissionPct), 30);

const listed = await s.call(
  'GET',
  `/admin/catalog/services?q=Commission Smoke ${stamp}`,
  undefined,
  200,
);
const row = listed?.data?.find((r) => r.id === serviceId);
s.check('percent is on the list row', Number(row?.commissionPct), 30);

s.section('edit changes it, and leaves it alone when absent');
const edited = await s.call(
  'PATCH',
  `/admin/catalog/services/${serviceId}`,
  { commissionPct: 18.5 },
  200,
);
s.check('percent updated', Number(edited?.data?.commissionPct), 18.5);

const renamed = await s.call(
  'PATCH',
  `/admin/catalog/services/${serviceId}`,
  { name: `Commission Smoke ${stamp} renamed` },
  200,
);
s.check('percent survives an unrelated edit', Number(renamed?.data?.commissionPct), 18.5);

const badEdit = await s.call(
  'PATCH',
  `/admin/catalog/services/${serviceId}`,
  { commissionPct: 150 },
  400,
);
s.check('an out-of-range edit is refused', s.errorCode(badEdit), 'VALIDATION_FAILED');

s.section('the public catalog does not leak the commission to customers');
const publicService = await s.call('GET', `/services/${serviceId}`, undefined, 200, 'none');
s.check('commission absent from the public body', publicService?.data?.commissionPct, undefined);

s.section('the per-provider override: optional, nullable, and it wins');
const trainers = await s.call('GET', '/admin/instructors?limit=1', undefined, 200);
const trainerId = trainers?.data?.[0]?.id;
s.check('a provider exists to override on', typeof trainerId, 'string');

const unset = await s.call('GET', `/admin/instructors/${trainerId}`, undefined, 200);
s.check('no override by default', unset?.data?.commissionPct, null);

const override = await s.call(
  'PATCH',
  `/admin/instructors/${trainerId}`,
  { commissionPct: 42 },
  200,
);
s.check('override stored', Number(override?.data?.commissionPct), 42);

const cleared = await s.call(
  'PATCH',
  `/admin/instructors/${trainerId}`,
  { commissionPct: null },
  200,
);
s.check('null clears it back to the service percent', cleared?.data?.commissionPct, null);

for (const [label, value] of [
  ['negative', -5],
  ['over 100', 120],
]) {
  const res = await s.call(
    'PATCH',
    `/admin/instructors/${trainerId}`,
    { commissionPct: value },
    400,
  );
  s.check(`${label} override refused`, s.errorCode(res), 'VALIDATION_FAILED');
}

s.section('Trainer Categories are gone, not merely hidden');
await s.call('GET', '/admin/trainer-categories', undefined, 404);
await s.call('POST', '/admin/trainer-categories', { name: 'Elite' }, 404);

  await s.cleanup(async (db) => {
    await db.service.deleteMany({ where: { id: serviceId } });
  });
});

s.done();
