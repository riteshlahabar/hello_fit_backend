/**
 * The VPS case: an address whose PIN is in no service area still gets a grid.
 *
 * `address-geo.ts:84` stores `areaId: null` for an unmapped PIN — the address
 * saves, and until 23-11-2026 `findSlots` answered it with `[]`, which is the
 * empty start-time grid the client reported. With
 * `scheduling.requireServiceArea` off, coverage no longer decides.
 *
 *   node -r dotenv/config test/probe-slots-no-area.mjs
 */
import { smoke, day } from './smoke-harness.mjs';

const s = smoke();

const services = await s.call('GET', '/services', undefined, 200, 'none');
await s.loginCustomer();

await s.cleanup(async (db) => {
  // A PIN no `pincodes` row can claim, so `areaId` comes back null.
  const orphan = '799999';
  const rows = await db.pincode.findMany({ where: { code: orphan } });
  console.log(`pincode rows for ${orphan}: ${rows.length} (want 0)`);

  const made = await s.call(
    'POST',
    '/app/customer/addresses',
    { label: 'No area', line1: 'Orphan Road', pincode: orphan },
    201,
    'customer',
  );

  const addressId = made?.data?.id;
  console.log(`address ${addressId} areaId=${JSON.stringify(made?.data?.areaId)}`);

  let best = 0;
  for (const svc of services?.data ?? []) {
    const grid = await s.call(
      'GET',
      `/app/customer/slots?serviceId=${svc.id}&date=${day(2)}&addressId=${addressId}`,
      undefined,
      200,
      'customer',
    );
    best = Math.max(best, (grid?.data ?? []).length);
  }

  console.log(`best grid across services: ${best} slots`);
  console.log(best > 0 ? 'PASS — an area-less address is offered times' : 'FAIL — still empty');

  await db.address.deleteMany({ where: { id: addressId } });
});
