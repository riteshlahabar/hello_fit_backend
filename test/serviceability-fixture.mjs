/**
 * Geography fixtures for `smoke-serviceability.mjs`, the way
 * `admin-fixture.mjs` and `payout-fixture.mjs` do it for their suites.
 *
 * Built through the **real Masters routes** rather than straight into Postgres,
 * so the suite also proves the admin screens and the public resolver agree on
 * what a pincode mapping is. Torn down by id.
 */

/** Distinct 6-digit PINs per run, so repeat or parallel runs never collide. */
export function pins() {
  const stamp = String(Date.now()).slice(-4);
  return {
    stamp,
    /** One area. The happy path. */
    one: `4${stamp}1`,
    /** Two areas — the `@@unique([code, areaId])` straddle. */
    many: `4${stamp}2`,
    /** Attached to nothing. */
    unknown: `4${stamp}3`,
    /** Attached, then deactivated. */
    inactive: `4${stamp}4`,
  };
}

/**
 * One city, two areas under it, four pincode rows, and the fourth deactivated.
 * Returns the ids so the suite can assert against them and clean up.
 *
 * @type {(s: any, p: ReturnType<typeof pins>) => Promise<{
 *   cityId: string, areaA: string, areaB: string, pincodeIds: string[] }>}
 */
export async function createGeography(s, p) {
  /** @type {{ cityId: string, areaA: string, areaB: string, pincodeIds: string[] }} */
  const made = { cityId: '', areaA: '', areaB: '', pincodeIds: [] };

  s.section('fixtures via the Masters routes');

  const city = await s.call('POST', '/admin/masters/cities', {
    name: `Serviceability ${p.stamp}`,
    state: 'Karnataka',
  }, 201);
  made.cityId = city?.data?.id ?? '';
  s.check('city created', made.cityId.length > 20, true);

  for (const name of ['Area A', 'Area B']) {
    const area = await s.call('POST', '/admin/masters/areas', {
      cityId: made.cityId,
      name: `${name} ${p.stamp}`,
    }, 201);
    if (name === 'Area A') made.areaA = area?.data?.id ?? '';
    else made.areaB = area?.data?.id ?? '';
  }
  s.check('two areas created', made.areaA !== '' && made.areaB !== '', true);

  for (const [code, areaId] of [
    [p.one, made.areaA],
    [p.many, made.areaA],
    [p.many, made.areaB],
    [p.inactive, made.areaB],
  ]) {
    const pin = await s.call('POST', '/admin/masters/pincodes', { code, areaId }, 201);
    if (pin?.data?.id) made.pincodeIds.push(pin.data.id);
  }
  s.check('four pincode rows', made.pincodeIds.length, 4);

  s.section('masters no longer accepts an unusable PIN');
  // Was /^\d{6}$/ here and /^[1-9][0-9]{5}$/ on addresses: ops could attach a
  // leading-zero PIN that no address could ever use.
  const zero = await s.call('POST', '/admin/masters/pincodes', {
    code: '012345',
    areaId: made.areaA,
  }, 400);
  s.check('leading zero refused', s.errorCode(zero) !== undefined, true);

  // Deactivate the last row so the resolver must exclude it.
  await s.call(
    'PATCH',
    `/admin/masters/pincodes/${made.pincodeIds[3]}`,
    { isActive: false },
  );

  return made;
}

/**
 * A real pincode whose area actually has an available teacher, together with a
 * service that teacher offers.
 *
 * Both ends must come from the same row: `findSlots` wants a teacher who serves
 * the area AND offers that exact service, so taking the service from
 * `/services` first row instead finds one the covered teacher does not teach
 * and the grid is empty for a reason that has nothing to do with pincodes.
 *
 * @type {(db: any) => Promise<null | { code: string, areaId: string,
 *   areaName: string, serviceId: string, serviceName: string }>}
 */
export async function findCoveredPin(db) {
  const link = await db.instructorServiceArea.findFirst({
    where: {
      instructor: {
        deletedAt: null,
        status: 'ACTIVE',
        kycStatus: 'VERIFIED',
        availabilityRules: { some: { isActive: true, deletedAt: null } },
        instructorServices: { some: { isActive: true, deletedAt: null } },
      },
      area: {
        isActive: true,
        deletedAt: null,
        pincodes: { some: { isActive: true, deletedAt: null } },
      },
    },
    select: {
      areaId: true,
      area: {
        select: {
          name: true,
          pincodes: {
            where: { isActive: true, deletedAt: null },
            select: { code: true },
            take: 1,
          },
        },
      },
      instructor: {
        select: {
          instructorServices: {
            where: { isActive: true, deletedAt: null },
            select: { service: { select: { id: true, name: true } } },
            take: 1,
          },
        },
      },
    },
  });

  if (!link) return null;

  return {
    code: link.area.pincodes[0].code,
    areaId: link.areaId,
    areaName: link.area.name,
    serviceId: link.instructor.instructorServices[0].service.id,
    serviceName: link.instructor.instructorServices[0].service.name,
  };
}
