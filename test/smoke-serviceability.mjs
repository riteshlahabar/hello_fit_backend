/**
 * Pincode -> service area, end to end.
 *
 * The assertion the whole item exists for is the last section: create an
 * address from a PIN alone, with no `areaId`, and get a NON-EMPTY slot grid
 * back. That had never passed — `POST /addresses` took `areaId` from the
 * client, no client could supply one, and `findSlots` answers an area-less
 * address with `[]` (`availability.service.ts:84`).
 *
 * Fixtures live in `serviceability-fixture.mjs`, per the 200-line rule.
 */
import { smoke, day } from './smoke-harness.mjs';
import { createGeography, findCoveredPin, pins } from './serviceability-fixture.mjs';

const s = smoke();
const p = pins();

/** @type {string[]} — typed so the ids interpolate cleanly. */
const addressIds = [];
/** @type {{ cityId: string, areaA: string, areaB: string, pincodeIds: string[] }} */
let geo = { cityId: '', areaA: '', areaB: '', pincodeIds: [] };

await s.withAdmin(async () => {
  geo = await createGeography(s, p);
});

s.section('public resolution — no token');

const one = await s.call('GET', `/serviceability/${p.one}`, undefined, 200, 'none');
s.check('one area serviceable', one?.data?.serviceable, true);
s.check('one area returned', one?.data?.areas?.length, 1);
s.check('echoes the pin', one?.data?.pincode, p.one);
s.check('carries the city', one?.data?.areas?.[0]?.cityName?.includes(p.stamp), true);

const many = await s.call('GET', `/serviceability/${p.many}`, undefined, 200, 'none');
s.check('straddling pin returns both', many?.data?.areas?.length, 2);

const unknown = await s.call('GET', `/serviceability/${p.unknown}`, undefined, 200, 'none');
s.check('unknown pin is not serviceable', unknown?.data?.serviceable, false);
s.check('unknown pin has no areas', unknown?.data?.areas?.length, 0);

const inactive = await s.call('GET', `/serviceability/${p.inactive}`, undefined, 200, 'none');
s.check('deactivated pin excluded', inactive?.data?.serviceable, false);

await s.call('GET', '/serviceability/12345', undefined, 400, 'none');
await s.call('GET', '/serviceability/012345', undefined, 400, 'none');

s.section('public areas and cities');

const areas = await s.call(
  'GET', `/serviceability/areas?cityId=${geo.cityId}`, undefined, 200, 'none',
);
s.check('areas for the city', areas?.data?.length, 2);

const cities = await s.call('GET', '/serviceability/cities', undefined, 200, 'none');
s.check('cities answer', Array.isArray(cities?.data), true);
s.check('the new city is listed', cities.data.some((c) => c.id === geo.cityId), true);

s.section('address writes resolve the area');

await s.loginCustomer();

const resolved = await s.call('POST', '/app/customer/addresses', {
  label: 'Home', line1: '12 Resolver Street', pincode: p.one,
}, 201, 'customer');
addressIds.push(resolved?.data?.id);
s.check('area resolved with no areaId sent', resolved?.data?.areaId, geo.areaA);
s.check('city resolved too', resolved?.data?.cityId, geo.cityId);

const ambiguous = await s.call('POST', '/app/customer/addresses', {
  label: 'Straddle', line1: '2 Both Areas Road', pincode: p.many,
}, 400, 'customer');
s.check('ambiguous refused', s.errorCode(ambiguous), 'AREA_AMBIGUOUS');
s.check('candidates returned to choose from', ambiguous?.error?.details?.length, 2);
s.check('and each candidate is pickable', typeof ambiguous?.error?.details?.[0]?.id, 'string');

const chosen = await s.call('POST', '/app/customer/addresses', {
  label: 'Chosen', line1: '2 Both Areas Road', pincode: p.many, areaId: geo.areaB,
}, 201, 'customer');
addressIds.push(chosen?.data?.id);
s.check('an explicit choice is honoured', chosen?.data?.areaId, geo.areaB);

const mismatch = await s.call('POST', '/app/customer/addresses', {
  label: 'Wrong', line1: '9 Mismatch Lane', pincode: p.one, areaId: geo.areaB,
}, 400, 'customer');
s.check('mismatch refused', s.errorCode(mismatch), 'PINCODE_AREA_MISMATCH');

const outside = await s.call('POST', '/app/customer/addresses', {
  label: 'Not served', line1: '1 Coming Soon Road', pincode: p.unknown,
}, 201, 'customer');
addressIds.push(outside?.data?.id);
s.check('an unserved pin still saves', outside?.data?.areaId, null);

s.section('a changed pin re-resolves, never keeps the old area');

const moved = await s.call('PATCH', `/app/customer/addresses/${addressIds[0]}`, {
  pincode: p.unknown,
}, 200, 'customer');
s.check('stale area dropped on move', moved?.data?.areaId, null);

const movedBack = await s.call('PATCH', `/app/customer/addresses/${addressIds[0]}`, {
  pincode: p.one,
}, 200, 'customer');
s.check('and resolved again on move back', movedBack?.data?.areaId, geo.areaA);

s.section('an area with no teacher resolves and still shows nothing');

const services = await s.call('GET', '/services', undefined, 200, 'none');
const anyServiceId = services?.data?.[0]?.id;
s.check('a service exists to book', typeof anyServiceId, 'string');

const unservedSlots = await s.call(
  'GET',
  `/app/customer/slots?serviceId=${anyServiceId}&date=${day(2)}&addressId=${addressIds[2]}`,
  undefined, 200, 'customer',
);
s.check('an unserved address returns the empty grid', unservedSlots?.data?.length, 0);

s.section('the point of all of it: a real covered PIN -> a usable grid');

const covered = await s.cleanup(findCoveredPin);

if (!covered) {
  console.log('      SKIPPED — no seeded area has an available teacher');
} else {
  console.log(
    `      using PIN ${covered.code} -> ${covered.areaName}, service ${covered.serviceName}`,
  );

  const real = await s.call('POST', '/app/customer/addresses', {
    label: 'Covered', line1: '4 Real Coverage Road', pincode: covered.code,
  }, 201, 'customer');
  addressIds.push(real?.data?.id);
  s.check('covered PIN resolved from the PIN alone', real?.data?.areaId, covered.areaId);

  // Walk a fortnight: one teacher's weekly availability need not fall on any
  // single chosen day, and an empty grid for that reason is not the resolver.
  let found = 0;
  let onDay = '';
  for (let offset = 1; offset <= 14 && found === 0; offset += 1) {
    const grid = await s.call(
      'GET',
      `/app/customer/slots?serviceId=${covered.serviceId}&date=${day(offset)}&addressId=${real?.data?.id}`,
      undefined, 200, 'customer',
    );
    found = grid?.data?.length ?? 0;
    if (found > 0) onDay = day(offset);
  }

  s.check('the slot grid is finally not empty', found > 0, true);
  console.log(`      ${found} slots on ${onDay} — booking can complete end to end`);
}

await s.noToken('POST', '/app/customer/addresses', {
  label: 'x', line1: 'y', pincode: p.one,
});

await s.cleanup(async (db) => {
  await db.address.deleteMany({ where: { id: { in: addressIds.filter(Boolean) } } });
  await db.pincode.deleteMany({ where: { areaId: { in: [geo.areaA, geo.areaB] } } });
  await db.serviceArea.deleteMany({ where: { id: { in: [geo.areaA, geo.areaB] } } });
  await db.city.deleteMany({ where: { id: geo.cityId } });
});

s.done();
