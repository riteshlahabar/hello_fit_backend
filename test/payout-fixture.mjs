/**
 * Seeds the *input* to the payout module — completed sessions with `PAYABLE`
 * earnings — and tears it all down afterwards.
 *
 * Why the earnings are inserted rather than earned: producing one through the
 * API means a booking, a payment, an assignment, an offer acceptance, a
 * check-in with a geo-fence and a check-out, then waiting out a 48-hour dispute
 * window. All of that is already covered by its own module. What is under test
 * here is what happens to an earning *once it is payable*, so that is where the
 * fixture starts.
 *
 * **Refuses to run outside development**, like `admin-fixture.mjs`.
 */
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';

/** Calendar-day helper: a @db.Date column truncates in UTC. */
function calendarDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function withPayoutFixture(run) {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('withPayoutFixture must never run against production');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required — run with -r dotenv/config');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const tag = `payout-smoke-${Date.now()}`;
  const created = { userIds: [], bookingIds: [], instructorId: null, customerId: null };

  try {
    const service = await prisma.service.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    const city = await prisma.city.findFirstOrThrow({ select: { id: true } });
    const area = await prisma.serviceArea.findFirstOrThrow({
      select: { id: true },
    });

    // --- the teacher, approved and KYC-verified, with bank details on file ---
    const instructorMobile = '6' + String(Date.now()).slice(-9);
    const instructorUser = await prisma.user.create({
      data: { mobile: instructorMobile, roles: ['INSTRUCTOR'] },
      select: { id: true },
    });
    created.userIds.push(instructorUser.id);

    const instructor = await prisma.instructorProfile.create({
      data: {
        userId: instructorUser.id,
        name: `Payout Teacher ${tag}`,
        bio: 'Fixture teacher.',
        languages: ['en'],
        specialisations: ['hatha'],
        homeBaseLat: 18.5204,
        homeBaseLng: 73.8567,
        onboardingStage: 'APPROVED',
        kycStatus: 'VERIFIED',
        joinedAt: new Date(),
      },
      select: { id: true },
    });
    created.instructorId = instructor.id;

    // `initiate` refuses without verified bank details, so the payout path
    // cannot be exercised without this row.
    await prisma.document.create({
      data: {
        ownerType: 'INSTRUCTOR',
        ownerId: instructor.id,
        docType: 'BANK_DETAILS',
        number: 'XXXXXX4321',
        fileUrl: `fixtures/${tag}/bank.pdf`,
        verifyStatus: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });

    // --- a customer with an address, so a booking can exist ---
    const customerUser = await prisma.user.create({
      data: { mobile: '5' + String(Date.now()).slice(-9), roles: ['CUSTOMER'] },
      select: { id: true },
    });
    created.userIds.push(customerUser.id);

    const customer = await prisma.customerProfile.create({
      data: {
        userId: customerUser.id,
        name: `Payout Customer ${tag}`,
        referralCode: `HF${randomUUID().replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase()}`,
      },
      select: { id: true },
    });
    created.customerId = customer.id;

    const address = await prisma.address.create({
      data: {
        customerId: customer.id,
        label: 'Home',
        line1: '1 Fixture Road',
        cityId: city.id,
        areaId: area.id,
        pincode: '411001',
        lat: 18.52,
        lng: 73.85,
        isDefault: true,
      },
      select: { id: true },
    });

    /**
     * Creates one completed session with an earning in the given state.
     * `sessionDate` decides which payout cycle it falls into, which is the
     * whole point of the cycle tests.
     */
    const addEarning = async ({
      sessionDate,
      sessionValue = 1000,
      commissionPercent = 25,
      status = 'PAYABLE',
      payableFrom = null,
      deductions = 0,
    }) => {
      const commissionAmount = (sessionValue * commissionPercent) / 100;
      const netAmount = sessionValue - commissionAmount - deductions;

      const booking = await prisma.booking.create({
        data: {
          code: `SMK${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 100)}`,
          customerId: customer.id,
          serviceId: service.id,
          addressId: address.id,
          grossAmount: sessionValue,
          payable: sessionValue,
          paymentStatus: 'PAID',
        },
        select: { id: true },
      });
      created.bookingIds.push(booking.id);

      const session = await prisma.bookingSession.create({
        data: {
          bookingId: booking.id,
          serviceId: service.id,
          sessionDate: calendarDay(sessionDate),
          fromMinute: 7 * 60,
          toMinute: 8 * 60,
          durationMin: 60,
          addressId: address.id,
          instructorId: instructor.id,
          status: 'COMPLETED',
          sessionValue,
          completedAt: new Date(),
        },
        select: { id: true },
      });

      return prisma.earning.create({
        data: {
          sessionId: session.id,
          instructorId: instructor.id,
          sessionValue,
          commissionAmount,
          deductions,
          netAmount,
          status,
          payableFrom,
        },
        select: { id: true, netAmount: true, status: true },
      });
    };

    return await run({
      prisma,
      instructorId: instructor.id,
      instructorUserId: instructorUser.id,
      instructorMobile,
      serviceName: service.name,
      addEarning,
      calendarDay,
    });
  } finally {
    // Order matters: payout items reference earnings, earnings reference
    // sessions, sessions cascade from bookings.
    try {
      if (created.instructorId) {
        const payouts = await prisma.payout.findMany({
          where: { instructorId: created.instructorId },
          select: { id: true },
        });
        await prisma.payoutItem.deleteMany({
          where: { payoutId: { in: payouts.map((p) => p.id) } },
        });
        await prisma.payout.deleteMany({
          where: { instructorId: created.instructorId },
        });
        await prisma.earning.deleteMany({
          where: { instructorId: created.instructorId },
        });
      }
      if (created.bookingIds.length > 0) {
        await prisma.booking.deleteMany({
          where: { id: { in: created.bookingIds } },
        });
      }
      if (created.customerId) {
        await prisma.address.deleteMany({
          where: { customerId: created.customerId },
        });
      }
      if (created.instructorId) {
        await prisma.document.deleteMany({
          where: { ownerType: 'INSTRUCTOR', ownerId: created.instructorId },
        });
      }
      // Profiles cascade from User.
      if (created.userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
      }
    } catch (error) {
      console.error('payout fixture cleanup failed:', error.message);
    }
    await prisma.$disconnect();
  }
}
