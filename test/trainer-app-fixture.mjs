/**
 * A whole trainer-app world the suite owns: an **approved** trainer, a
 * customer with an address, and five sessions covering every bucket the four
 * tabs filter on — plus one pending `DIRECT` request, which is the §4.7 piece.
 *
 * Built through Prisma, for the reason `provider-search-fixture.mjs` gives:
 * there is no endpoint that produces an approved trainer with a paid booking
 * already assigned, and driving onboarding + checkout here would test those
 * modules rather than these screens.
 *
 * Created and removed by id. Nothing is left behind, so repeat runs do not
 * drift the summary counts the suite asserts on.
 */

/** YYYY-MM-DD at UTC midnight, the shape a `@db.Date` column holds. */
function day(offset) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

export async function createWorld(db, stamp, mobile) {
  const city = await db.city.create({
    data: { name: `Trainerville ${stamp}`, state: 'Maharashtra' },
  });
  const area = await db.serviceArea.create({
    data: { cityId: city.id, name: `Baner ${stamp}` },
  });
  const category = await db.serviceCategory.create({
    data: { name: `Strength ${stamp}`, slug: `strength-${stamp}`, sortOrder: 98 },
  });
  const service = await db.service.create({
    data: {
      categoryId: category.id,
      name: `Personal Training ${stamp}`,
      slug: `personal-training-${stamp}`,
      durationMin: 60,
      basePrice: 800,
      commissionPct: 25,
    },
  });

  // `roles` is a column on User, not derived from the profile — without
  // INSTRUCTOR in it the token is a customer's and every tab 403s.
  const trainerUser = await db.user.create({
    data: { mobile, status: 'ACTIVE', roles: ['CUSTOMER', 'INSTRUCTOR'] },
  });

  const trainer = await db.instructorProfile.create({
    data: {
      userId: trainerUser.id,
      name: 'Smoke Trainer',
      experienceYears: 7,
      specialisations: ['Strength'],
      status: 'ACTIVE',
      kycStatus: 'VERIFIED',
      // APPROVED, because every route but `/dashboard` requires it.
      onboardingStage: 'APPROVED',
      instructorServices: {
        create: { serviceId: service.id, isActive: true, approvedAt: new Date() },
      },
      instructorServiceAreas: { create: { areaId: area.id } },
    },
  });

  const customerUser = await db.user.create({
    data: { mobile: `6${stamp}`.slice(0, 10), status: 'ACTIVE', roles: ['CUSTOMER'] },
  });
  const customer = await db.customerProfile.create({
    data: {
      userId: customerUser.id,
      name: 'Aditi Kulkarni',
      referralCode: `SMK${stamp}`.slice(0, 20),
      // Pages 31 and 32 show both; they are the only two customer-profile
      // columns the trainer surface reads.
      goal: 'Build strength and improve overall fitness',
      healthNotes: 'Recovering from a knee injury — no deep squats',
    },
  });
  const address = await db.address.create({
    data: {
      customerId: customer.id,
      label: 'Home',
      line1: '12 Hill Road',
      cityId: city.id,
      areaId: area.id,
      pincode: '411045',
      isDefault: true,
    },
  });

  const booking = await db.booking.create({
    data: {
      code: `SMK-${stamp}`.slice(0, 20),
      customerId: customer.id,
      serviceId: service.id,
      addressId: address.id,
      type: 'PACKAGE',
      sessionCount: 5,
      grossAmount: 4000,
      payable: 4000,
      paymentStatus: 'PAID',
    },
  });

  // One per bucket, so the summary tiles and every filter chip have a row:
  // two delivered, one accepted and upcoming, one today, and one still
  // awaiting the trainer's answer.
  const plan = [
    { sequence: 1, offset: -9, status: 'COMPLETED' },
    { sequence: 2, offset: -2, status: 'COMPLETED' },
    { sequence: 3, offset: 0, status: 'ASSIGNED' },
    { sequence: 4, offset: 4, status: 'ASSIGNED' },
    { sequence: 5, offset: 6, status: 'CONFIRMED' },
  ];

  const sessions = [];
  for (const row of plan) {
    sessions.push(
      await db.bookingSession.create({
        data: {
          bookingId: booking.id,
          sequence: row.sequence,
          serviceId: service.id,
          sessionDate: day(row.offset),
          fromMinute: 7 * 60 + 30,
          toMinute: 8 * 60 + 30,
          durationMin: 60,
          addressId: address.id,
          instructorId: trainer.id,
          status: row.status,
          sessionValue: 800,
          checkInOtp: '1234',
        },
      }),
    );
  }

  // §4.7: the last session is the customer's direct request, unanswered.
  const request = await db.assignment.create({
    data: {
      sessionId: sessions[4].id,
      instructorId: trainer.id,
      mode: 'DIRECT',
      response: 'PENDING',
    },
  });

  // Earnings on the two delivered sessions, one payable and one still in its
  // dispute window, so page 57's two balance tiles are both non-zero.
  const earnings = [];
  for (const [index, status] of ['PAID', 'PAYABLE'].entries()) {
    earnings.push(
      await db.earning.create({
        data: {
          sessionId: sessions[index].id,
          instructorId: trainer.id,
          sessionValue: 800,
          commissionAmount: 200,
          netAmount: 600,
          status,
        },
      }),
    );
  }

  return {
    mobile,
    trainerId: trainer.id,
    trainerUserId: trainerUser.id,
    customerId: customer.id,
    customerUserId: customerUser.id,
    serviceId: service.id,
    categoryId: category.id,
    areaId: area.id,
    cityId: city.id,
    addressId: address.id,
    bookingId: booking.id,
    sessionIds: sessions.map((s) => s.id),
    requestId: request.id,
    earningIds: earnings.map((e) => e.id),
  };
}

/** Children first — every FK here is `Restrict` or `Cascade`, never a dangle. */
export async function removeWorld(db, made) {
  await db.earning.deleteMany({ where: { instructorId: made.trainerId } });
  await db.assignment.deleteMany({ where: { instructorId: made.trainerId } });
  await db.bookingStatusHistory.deleteMany({ where: { bookingId: made.bookingId } });
  await db.bookingSession.deleteMany({ where: { bookingId: made.bookingId } });
  await db.booking.deleteMany({ where: { id: made.bookingId } });
  await db.address.deleteMany({ where: { id: made.addressId } });
  await db.customerProfile.deleteMany({ where: { id: made.customerId } });
  await db.instructorServiceArea.deleteMany({ where: { instructorId: made.trainerId } });
  await db.instructorService.deleteMany({ where: { instructorId: made.trainerId } });
  await db.instructorProfile.deleteMany({ where: { id: made.trainerId } });
  await db.user.deleteMany({
    where: { id: { in: [made.trainerUserId, made.customerUserId] } },
  });
  await db.service.deleteMany({ where: { id: made.serviceId } });
  await db.serviceCategory.deleteMany({ where: { id: made.categoryId } });
  await db.serviceArea.deleteMany({ where: { id: made.areaId } });
  await db.city.deleteMany({ where: { id: made.cityId } });
}
