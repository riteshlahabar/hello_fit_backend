/**
 * Public package list — GET /packages (client, 17 Nov 2026; reshaped 18 Nov).
 *
 * The website's Package page reads this. A package holds a percentage and its
 * own `persons`, and it names the services it is sold on:
 *
 *   * no `serviceId` — every live package, prices null (terms only);
 *   * with one — only the packages that service is sold on, priced
 *     `basePrice x persons x sessionCount` then the percent;
 *   * a package with no service ticked is listed nowhere.
 *
 *     npm run smoke:catalog-packages
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const tag = `pkglist-${Date.now()}`;
const fixture = await s.cleanup(async (db) => {
  const category = await db.serviceCategory.create({
    data: { name: `Cat ${tag}`, slug: `cat-${tag}` },
  });

  const service = (name) =>
    db.service.create({
      data: {
        categoryId: category.id,
        name: `${name} ${tag}`,
        slug: `${name.toLowerCase()}-${tag}`,
        durationMin: 60,
        basePrice: 600,
        commissionPct: 25,
      },
    });

  const yoga = await service('Yoga');
  const gym = await service('Gym');

  // Sold on yoga only: a solo monthly pack.
  const monthly = await db.package.create({
    data: {
      name: `Monthly ${tag}`,
      sessionCount: 10,
      validityDays: 30,
      percentAdjust: -15,
      allowedWeekdays: [],
      sortOrder: 1,
      services: { create: [{ serviceId: yoga.id }] },
    },
  });

  // Sold on yoga too, and for three people — what GroupSlab used to do.
  const trio = await db.package.create({
    data: {
      name: `Trio ${tag}`,
      sessionCount: 24,
      persons: 3,
      validityDays: 30,
      percentAdjust: -20,
      allowedWeekdays: [],
      sortOrder: 2,
      services: { create: [{ serviceId: yoga.id }] },
    },
  });

  // Sold on gym only — it must not appear under yoga.
  const gymOnly = await db.package.create({
    data: {
      name: `GymOnly ${tag}`,
      sessionCount: 5,
      validityDays: 7,
      percentAdjust: 10,
      allowedWeekdays: [],
      sortOrder: 3,
      services: { create: [{ serviceId: gym.id }] },
    },
  });

  // No service ticked at all: sold nowhere.
  const orphan = await db.package.create({
    data: {
      name: `Orphan ${tag}`,
      sessionCount: 4,
      validityDays: 30,
      percentAdjust: 0,
      allowedWeekdays: [],
      sortOrder: 4,
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
      services: { create: [{ serviceId: yoga.id }] },
    },
  });

  return { category, yoga, gym, monthly, trio, gymOnly, orphan, retired };
});

s.section('the bare list carries terms, not prices');
const bare = await s.call('GET', '/packages', undefined, 200, 'none');
const rows = bare?.data ?? [];
s.check('answers an array', Array.isArray(rows), true);

const monthly = rows.find((row) => row.id === fixture.monthly.id);
s.check('the monthly package is listed', Boolean(monthly), true);
s.check('no service, no price', monthly?.price, null);
s.check('no service, no per-session price', monthly?.perSessionPrice, null);
s.check('percent comes through as a number', monthly?.percentAdjust, -15);
s.check('session count', monthly?.sessionCount, 10);
s.check('one person by default', monthly?.persons, 1);
s.check('it names its service', monthly?.services?.[0]?.id, fixture.yoga.id);

const trio = rows.find((row) => row.id === fixture.trio.id);
s.check('the group package carries its head count', trio?.persons, 3);

s.check(
  'a retired package never reaches the website',
  rows.some((row) => row.id === fixture.retired.id),
  false,
);

s.section('sort order decides the running order');
const ours = rows.filter((row) => row.name.endsWith(tag)).map((row) => row.id);
s.check('monthly, trio, gym, orphan', ours, [
  fixture.monthly.id,
  fixture.trio.id,
  fixture.gymOnly.id,
  fixture.orphan.id,
]);

s.section('a service narrows the list and supplies the rate');
const priced = await s.call(
  'GET',
  `/packages?serviceId=${fixture.yoga.id}`,
  undefined,
  200,
  'none',
);
const forYoga = priced?.data ?? [];
s.check('only yoga packages', forYoga.length, 2);

const pricedMonthly = forYoga.find((row) => row.id === fixture.monthly.id);
s.check('600 x 1 x 10 less 15% is 5100', pricedMonthly?.price, 5100);
s.check('per session', pricedMonthly?.perSessionPrice, 510);

const pricedTrio = forYoga.find((row) => row.id === fixture.trio.id);
s.check('600 x 3 x 24 less 20% is 34560', pricedTrio?.price, 34560);
s.check('per session for the three', pricedTrio?.perSessionPrice, 1440);

s.check(
  "another service's package is not offered",
  forYoga.some((row) => row.id === fixture.gymOnly.id),
  false,
);
s.check(
  'a package with no service is offered nowhere',
  forYoga.some((row) => row.id === fixture.orphan.id),
  false,
);

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
