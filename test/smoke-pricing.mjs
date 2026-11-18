/**
 * Package and group pricing (client pricing doc, 17 Nov 2026).
 *
 * Proves the two systems never meet: a solo service prices by package
 * percent with one person, a group service prices by slab with no package.
 * Packages are global now, so one package row serves both services.
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const tag = `pricing-${Date.now()}`;
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
    },
  });

  // The seed ships 3 / 5 / 10 and `minPersons` is unique, so a plain create
  // collides on a seeded database. Reuse the row when it is already there and
  // let cleanup drop only what this run made.
  const slabs = [];

  for (const data of [
    { minPersons: 3, percentOff: 20 },
    { minPersons: 5, percentOff: 30 },
  ]) {
    const seeded = await db.groupSlab.findUnique({
      where: { minPersons: data.minPersons },
    });

    slabs.push(seeded ?? { ...(await db.groupSlab.create({ data })), mine: true });
  }

  return { category, solo, group, monthly, trial, slabs };
});

await s.loginCustomer();

s.section('service detail derives package prices');
const detail = await s.call(
  'GET',
  `/services/${fixture.solo.id}`,
  undefined,
  200,
  'none',
);
const monthlyOption = detail?.data?.packages?.find(
  (row) => row.id === fixture.monthly.id,
);
s.check('monthly price is 600 x 10 less 15%', monthlyOption?.price, 5100);
s.check('per-session price', monthlyOption?.perSessionPrice, 510);
s.check('solo service offers no slabs', detail?.data?.groupSlabs?.length, 0);

const groupDetail = await s.call(
  'GET',
  `/services/${fixture.group.id}`,
  undefined,
  200,
  'none',
);
s.check('group service hides packages', groupDetail?.data?.packages?.length, 0);
s.check(
  'group service offers slabs',
  groupDetail?.data?.groupSlabs?.length >= 2,
  true,
);

s.section('quote applies one percent, never two');
const pkgQuote = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.solo.id, packageId: fixture.monthly.id },
  201,
  'customer',
);
s.check('package gross', pkgQuote?.data?.grossAmount, 5100);
s.check('package sessions', pkgQuote?.data?.sessionCount, 10);
s.check('package head count', pkgQuote?.data?.participantCount, 1);

const trialQuote = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.solo.id, packageId: fixture.trial.id },
  201,
  'customer',
);
s.check('trial gross is 600 plus 20%', trialQuote?.data?.grossAmount, 720);
s.check('trial throws in one free session', trialQuote?.data?.freeSessionCount, 1);

const groupQuote = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.group.id, participantCount: 5 },
  201,
  'customer',
);
s.check('five people at 30% off', groupQuote?.data?.grossAmount, 2100);
s.check('slab percent is signed', groupQuote?.data?.percentAdjust, -30);

const belowSlab = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.group.id, participantCount: 2 },
  201,
  'customer',
);
s.check('two people get no slab', belowSlab?.data?.grossAmount, 1200);

const betweenSlabs = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.group.id, participantCount: 4 },
  201,
  'customer',
);
s.check('four people fall to the 3-person slab', betweenSlabs?.data?.grossAmount, 1920);

s.section('the systems are kept apart');
await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.solo.id, participantCount: 3 },
  400,
  'customer',
);
await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.group.id, packageId: fixture.monthly.id },
  400,
  'customer',
);
await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: fixture.group.id, participantCount: 50 },
  400,
  'customer',
);

await s.noToken('POST', '/app/customer/bookings/quote', {
  serviceId: fixture.solo.id,
});

await s.cleanup(async (db) => {
  await db.groupSlab.deleteMany({
    where: {
      id: { in: fixture.slabs.filter((row) => row.mine).map((row) => row.id) },
    },
  });
  await db.package.deleteMany({
    where: { id: { in: [fixture.monthly.id, fixture.trial.id] } },
  });
  await db.service.deleteMany({
    where: { id: { in: [fixture.solo.id, fixture.group.id] } },
  });
  await db.serviceCategory.delete({ where: { id: fixture.category.id } });
});

s.done();
