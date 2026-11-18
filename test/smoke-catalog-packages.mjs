/**
 * Public package list — GET /packages (client, 17 Nov 2026).
 *
 * The website's Package page reads this. A package is global and holds a
 * percentage, so the list is priceless until a service supplies the rate:
 * without `serviceId` every price is null, with one they are worked out, and
 * a group service answers with nothing at all because a slab prices it.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const tag = `pkglist-${Date.now()}`;
const fixture = await s.cleanup(async (db) => {
  const category = await db.serviceCategory.create({
    data: { name: `Cat ${tag}`, slug: `cat-${tag}` },
  });

  const solo = await db.service.create({
    data: {
      categoryId: category.id,
      name: `Solo ${tag}`,
      slug: `solo-${tag}`,
      durationMin: 60,
      basePrice: 600,
      allowMultiPerson: false,
      maxParticipants: 1,
    },
  });

  const group = await db.service.create({
    data: {
      categoryId: category.id,
      name: `Group ${tag}`,
      slug: `group-${tag}`,
      durationMin: 60,
      basePrice: 600,
      allowMultiPerson: true,
      maxParticipants: 10,
    },
  });

  const monthly = await db.package.create({
    data: {
      name: `Monthly ${tag}`,
      sessionCount: 10,
      validityDays: 30,
      percentAdjust: -15,
      allowedWeekdays: [],
      sortOrder: 1,
    },
  });

  const trial = await db.package.create({
    data: {
      name: `Trial ${tag}`,
      sessionCount: 1,
      validityDays: 7,
      percentAdjust: 20,
      freeSessionCount: 1,
      allowedWeekdays: [],
      sortOrder: 2,
    },
  });

  const retired = await db.package.create({
    data: {
      name: `Retired ${tag}`,
      sessionCount: 4,
      validityDays: 30,
      percentAdjust: 0,
      allowedWeekdays: [],
      isActive: false,
    },
  });

  return { category, solo, group, monthly, trial, retired };
});

s.section('the list is public and carries terms, not prices');
const bare = await s.call('GET', '/packages', undefined, 200, 'none');
const rows = bare?.data ?? [];
s.check('answers an array', Array.isArray(rows), true);

const monthly = rows.find((row) => row.id === fixture.monthly.id);
s.check('the monthly package is listed', Boolean(monthly), true);
s.check('no service, no price', monthly?.price, null);
s.check('no service, no per-session price', monthly?.perSessionPrice, null);
s.check('percent comes through as a number', monthly?.percentAdjust, -15);
s.check('session count', monthly?.sessionCount, 10);
s.check('validity', monthly?.validityDays, 30);

const trial = rows.find((row) => row.id === fixture.trial.id);
s.check('the trial is listed', Boolean(trial), true);
s.check('free session count', trial?.freeSessionCount, 1);

s.check(
  'a retired package never reaches the website',
  rows.some((row) => row.id === fixture.retired.id),
  false,
);

s.section('sort order decides the running order');
const ours = rows.filter((row) => row.name.endsWith(tag)).map((row) => row.id);
s.check('monthly before trial', ours, [fixture.monthly.id, fixture.trial.id]);

s.section('a service supplies the rate the percent applies to');
const priced = await s.call(
  'GET',
  `/packages?serviceId=${fixture.solo.id}`,
  undefined,
  200,
  'none',
);
const pricedMonthly = priced?.data?.find((row) => row.id === fixture.monthly.id);
s.check('600 x 10 less 15% is 5100', pricedMonthly?.price, 5100);
s.check('per session', pricedMonthly?.perSessionPrice, 510);

const pricedTrial = priced?.data?.find((row) => row.id === fixture.trial.id);
s.check('600 plus 20% is 720', pricedTrial?.price, 720);

s.section('a group service prices by slab, so it offers no package');
const forGroup = await s.call(
  'GET',
  `/packages?serviceId=${fixture.group.id}`,
  undefined,
  200,
  'none',
);
s.check('empty for a group service', forGroup?.data?.length, 0);

s.section('rejections');
const missing = await s.call(
  'GET',
  '/packages?serviceId=00000000-0000-4000-8000-000000000000',
  undefined,
  404,
  'none',
);
s.check('unknown service is a 404', s.errorCode(missing), 'NOT_FOUND');

await s.call('GET', '/packages?serviceId=not-a-uuid', undefined, 400, 'none');

await s.cleanup(async (db) => {
  await db.package.deleteMany({ where: { name: { endsWith: tag } } });
  await db.service.deleteMany({ where: { slug: { endsWith: tag } } });
  await db.serviceCategory.deleteMany({ where: { slug: { endsWith: tag } } });
});

s.done();
