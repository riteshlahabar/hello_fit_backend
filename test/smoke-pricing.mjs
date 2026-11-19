/**
 * Package pricing (client pricing doc 17 Nov 2026, reshaped 18 Nov).
 *
 * One money rule and one discount: `basePrice x persons x sessionCount`, then
 * the package's percent. The package carries both the session count and the
 * head count and names the services it is sold on, so this proves:
 *
 *   * a service offers only its own packages;
 *   * a group deal is a package with `persons` above 1;
 *   * no package means one person, one session, full price;
 *   * a package not sold on the service is refused.
 *
 *     npm run smoke:pricing
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const tag = `pricing-${Date.now()}`;
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

  const monthly = await db.package.create({
    data: {
      name: `Monthly ${tag}`,
      sessionCount: 10,
      validityDays: 30,
      percentAdjust: -15,
      allowedWeekdays: [],
      services: { create: [{ serviceId: yoga.id }] },
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
      services: { create: [{ serviceId: yoga.id }] },
    },
  });

  // What GroupSlab used to do: five people, 30% off, as one package row.
  const group = await db.package.create({
    data: {
      name: `Group of 5 ${tag}`,
      sessionCount: 1,
      persons: 5,
      validityDays: 30,
      percentAdjust: -30,
      allowedWeekdays: [],
      services: { create: [{ serviceId: yoga.id }] },
    },
  });

  const gymOnly = await db.package.create({
    data: {
      name: `GymOnly ${tag}`,
      sessionCount: 5,
      validityDays: 7,
      percentAdjust: 0,
      allowedWeekdays: [],
      services: { create: [{ serviceId: gym.id }] },
    },
  });

  return { category, yoga, gym, monthly, trial, group, gymOnly };
});

s.section('the service detail screen offers only its own packages');
const detail = await s.call(
  'GET',
  `/services/${fixture.yoga.id}`,
  undefined,
  200,
  'none',
);
const offered = detail?.data?.packages ?? [];
s.check('three packages on yoga', offered.length, 3);

const monthlyOption = offered.find((row) => row.id === fixture.monthly.id);
s.check('monthly price is 600 x 1 x 10 less 15%', monthlyOption?.price, 5100);
s.check('per-session price', monthlyOption?.perSessionPrice, 510);

const groupOption = offered.find((row) => row.id === fixture.group.id);
s.check('five people at 30% off is 2100', groupOption?.price, 2100);
s.check('head count comes with it', groupOption?.persons, 5);

s.check(
  "the gym package is not on yoga",
  offered.some((row) => row.id === fixture.gymOnly.id),
  false,
);

s.section('the quote applies the package percent');
// The quote is a customer route. Without this the suite sent every call below
// with an empty bearer and read twenty 401s as pricing failures.
await s.loginCustomer();

const pkgQuote = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.yoga.id, packageId: fixture.monthly.id },
  201,
  'customer',
);
s.check('package gross', pkgQuote?.data?.grossAmount, 5100);
s.check('package sessions', pkgQuote?.data?.sessionCount, 10);
s.check('package head count', pkgQuote?.data?.participantCount, 1);

const trialQuote = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.yoga.id, packageId: fixture.trial.id },
  201,
  'customer',
);
s.check('trial gross is 600 plus 20%', trialQuote?.data?.grossAmount, 720);
s.check('trial throws in one free session', trialQuote?.data?.freeSessionCount, 1);

const groupQuote = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.yoga.id, packageId: fixture.group.id },
  201,
  'customer',
);
s.check('five people at 30% off', groupQuote?.data?.grossAmount, 2100);
s.check('head count from the package', groupQuote?.data?.participantCount, 5);
s.check('percent is signed', groupQuote?.data?.percentAdjust, -30);

s.section('no package means one person, one session, full price');
const plain = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.yoga.id },
  201,
  'customer',
);
s.check('plain gross', plain?.data?.grossAmount, 600);
s.check('one person', plain?.data?.participantCount, 1);

s.section('the head count belongs to the package');
// A request may send it, but only the figure the package already carries.
await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.yoga.id, participantCount: 3 },
  400,
  'customer',
);
await s.call(
  'POST',
  '/app/customer/bookings/quote',
  {
    serviceId: fixture.yoga.id,
    packageId: fixture.group.id,
    participantCount: 3,
  },
  400,
  'customer',
);
const agreeing = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  {
    serviceId: fixture.yoga.id,
    packageId: fixture.group.id,
    participantCount: 5,
  },
  201,
  'customer',
);
s.check('the matching head count is accepted', agreeing?.data?.grossAmount, 2100);

s.section('a package not sold on the service is refused');
const wrong = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.yoga.id, packageId: fixture.gymOnly.id },
  404,
  'customer',
);
s.check('refused as not found', s.errorCode(wrong), 'NOT_FOUND');

await s.noToken('POST', '/app/customer/bookings/quote', {
  serviceId: fixture.yoga.id,
});

await s.cleanup(async (db) => {
  await db.package.deleteMany({ where: { name: { endsWith: tag } } });
  await db.service.deleteMany({ where: { slug: { endsWith: tag } } });
  await db.serviceCategory.delete({ where: { id: fixture.category.id } });
});

s.done();
