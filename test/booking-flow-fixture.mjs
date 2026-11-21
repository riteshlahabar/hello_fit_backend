/**
 * Fixtures for `smoke-web-booking-flow.mjs`, kept apart under the 200-line
 * rule.
 *
 * Built on `createProvider` from `provider-search-fixture.mjs`, which already
 * makes a city, an area, a category, a 60-minute service and an ACTIVE,
 * KYC-verified provider whose offering is **not yet approved** and who has
 * **no availability rules at all** — which is exactly the state this suite
 * needs to prove both the `serviceId` filter and the open-window fallback.
 *
 * Added on top: a pincode so an address can resolve its own area, a second
 * service in the same category so "same category, different service" can be
 * told apart, and a package sold on the first service.
 */

/** @type {(db: any, made: any, stamp: string) => Promise<{ secondServiceId: string, packageId: string, pincodeId: string, pin: string }>} */
export async function extend(db, made, stamp) {
  const pin = `5${stamp.slice(-5)}`;

  const pincode = await db.pincode.create({
    data: { areaId: made.areaId, code: pin, isActive: true },
  });

  const second = await db.service.create({
    data: {
      categoryId: made.categoryId,
      name: `Aerial Straps ${stamp}`,
      slug: `aerial-straps-${stamp}`,
      durationMin: 60,
      basePrice: 900,
      commissionPct: 25,
    },
  });

  // -10%: a signed percent on the gross, so the quote must come back below
  // the service rate. A package is the only discount there is.
  const pack = await db.package.create({
    data: {
      name: `Flow Pack ${stamp}`,
      sessionCount: 1,
      persons: 1,
      validityDays: 30,
      percentAdjust: -10,
      allowedWeekdays: [],
      services: { create: { serviceId: made.serviceId } },
    },
  });

  return {
    secondServiceId: second.id,
    packageId: pack.id,
    pincodeId: pincode.id,
    pin,
  };
}

/**
 * Children first, then everything `createProvider` made.
 *
 * A settled booking leaves more behind than it created: an invoice, a
 * payment, status history, earnings and the assignment the confirmation
 * raised. Missing any of them leaves a foreign key holding the booking in
 * place and the next run counting it.
 */
export async function removeExtras(db, made, extra, addressIds, bookingIds) {
  await db.invoice.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.bookingStatusHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.earning.deleteMany({ where: { session: { bookingId: { in: bookingIds } } } });
  await db.assignment.deleteMany({ where: { session: { bookingId: { in: bookingIds } } } });
  await db.bookingSession.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await db.address.deleteMany({ where: { id: { in: addressIds } } });
  await db.packageService.deleteMany({ where: { packageId: extra.packageId } });
  await db.package.deleteMany({ where: { id: extra.packageId } });
  await db.pincode.deleteMany({ where: { id: extra.pincodeId } });
  await db.instructorService.deleteMany({ where: { serviceId: extra.secondServiceId } });
  await db.service.deleteMany({ where: { id: extra.secondServiceId } });
}
