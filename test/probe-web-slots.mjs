/**
 * Why the website's step 2 shows no start time — probe, not a suite.
 *
 * Walks the exact questions the page asks, against the real dev data:
 * services -> providers for that service -> an address in a serviceable
 * PIN -> GET /slots, for every service, so the empty answer names itself.
 *
 *   node test/probe-web-slots.mjs
 */
import { smoke, day } from './smoke-harness.mjs';

const s = smoke();

const services = await s.call('GET', '/services', undefined, 200, 'none');
const rows = services?.data ?? [];
console.log(`services: ${rows.length}`);

await s.loginCustomer();

await s.cleanup(async (db) => {
  const pins = await db.pincode.findMany({
    where: { deletedAt: null },
    select: { code: true, areaId: true },
  }).then((all) => all.filter((p) => p.areaId).slice(0, 10));
  console.log(`serviceable pincodes: ${pins.map((p) => p.code).join(', ') || 'NONE'}`);

  const providers = await db.instructorProfile.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      kycStatus: true,
      instructorServices: {
        where: { deletedAt: null },
        select: { serviceId: true, isActive: true, approvedAt: true },
      },
      instructorServiceAreas: { select: { areaId: true } },
      availabilityRules: {
        where: { deletedAt: null },
        select: { weekday: true, startMinute: true, endMinute: true, isActive: true },
      },
    },
  });

  console.log(`\nproviders: ${providers.length}`);
  for (const p of providers) {
    const ok = p.instructorServices.filter((r) => r.isActive && r.approvedAt);
    console.log(
      `  ${p.id.slice(0, 8)} ${p.status}/${p.kycStatus} ` +
        `services=${p.instructorServices.length} approved=${ok.length} ` +
        `areas=${p.instructorServiceAreas.length} rules=${p.availabilityRules.length}`,
    );
  }

  if (!pins[0]) return;

  const made = await s.call(
    'POST',
    '/app/customer/addresses',
    { label: 'Probe', line1: 'Probe Road', pincode: pins[0].code },
    201,
    'customer',
  );
  const addressId = made?.data?.id;
  console.log(`\naddress ${addressId} pin=${pins[0].code} area=${made?.data?.areaId}`);

  console.log('\nservice -> providers listed -> slot count (any provider)');

  for (const svc of rows) {
    const listed = await s.call(
      'GET', `/providers?serviceId=${svc.id}`, undefined, 200, 'none',
    );
    const plist = listed?.data ?? [];

    const grid = await s.call(
      'GET',
      `/app/customer/slots?serviceId=${svc.id}&date=${day(2)}&addressId=${addressId}`,
      undefined, 200, 'customer',
    );

    let one = '';
    if (plist[0]) {
      const pinned = await s.call(
        'GET',
        `/app/customer/slots?serviceId=${svc.id}&date=${day(2)}` +
          `&addressId=${addressId}&instructorId=${plist[0].id}`,
        undefined, 200, 'customer',
      );
      one = ` pinned=${(pinned?.data ?? []).length}`;
    }

    console.log(
      `  ${svc.name.padEnd(28)} providers=${String(plist.length).padEnd(3)} ` +
        `slots=${String((grid?.data ?? []).length).padEnd(3)}${one}`,
    );
  }

  await db.address.deleteMany({ where: { id: addressId } });
});

console.log('\nprobe done');
