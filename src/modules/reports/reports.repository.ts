import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  InstructorStatus,
  KycStatus,
  OnboardingStage,
  UserStatus,
} from '../../generated/prisma/enums';

/**
 * Onboarding stages that still need an administrator to act. Same four as
 * `DashboardRepository` — APPROVED and REJECTED are decided, so neither is
 * pending.
 */
const PENDING_STAGES = [
  OnboardingStage.APPLIED,
  OnboardingStage.DOCUMENTS_SUBMITTED,
  OnboardingStage.SCREENING_CALL,
  OnboardingStage.DEMO_SESSION,
];

/** The booking fields the per-day report buckets. */
export interface BookingRangeRow {
  createdAt: Date;
  sessionCount: number;
  grossAmount: Prisma.Decimal;
  discount: Prisma.Decimal;
  payable: Prisma.Decimal;
}

/**
 * Prisma access for PDF 6.12. Queries only — every shaping rule lives in
 * `ReportsService`.
 *
 * Every window here is **half-open**: `gte: from, lt: to`, where `to` is
 * midnight *after* the last day the administrator asked for. That is what
 * makes an inclusive day range inclusive without a date arithmetic trap.
 *
 * These are 6.12's range-scoped counts and are deliberately **not** shared
 * with `DashboardRepository`, whose window is a single day and whose totals
 * are platform-wide. Merging them would mean one of the two screens getting a
 * window it never asked for.
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------- customers & providers

  /** Platform totals: what the marketplace holds right now, not in a window. */
  async accountTotals() {
    const [
      customers,
      activeCustomers,
      suspendedCustomers,
      blockedCustomers,
      providers,
      activeProviders,
      pendingApplications,
      kycPending,
    ] = await Promise.all([
      this.prisma.customerProfile.count({ where: { deletedAt: null } }),
      this.prisma.customerProfile.count({
        where: { deletedAt: null, user: { status: UserStatus.ACTIVE } },
      }),
      this.prisma.customerProfile.count({
        where: { deletedAt: null, user: { status: UserStatus.SUSPENDED } },
      }),
      this.prisma.customerProfile.count({
        where: { deletedAt: null, isBlocked: true },
      }),
      this.prisma.instructorProfile.count({ where: { deletedAt: null } }),
      this.prisma.instructorProfile.count({
        where: { deletedAt: null, status: InstructorStatus.ACTIVE },
      }),
      this.prisma.instructorProfile.count({
        where: { deletedAt: null, onboardingStage: { in: PENDING_STAGES } },
      }),
      this.prisma.instructorProfile.count({
        where: { deletedAt: null, kycStatus: KycStatus.PENDING },
      }),
    ]);

    return {
      customers,
      activeCustomers,
      suspendedCustomers,
      blockedCustomers,
      providers,
      activeProviders,
      pendingApplications,
      kycPending,
    };
  }

  /** Accounts *created* inside the window — the "new in this range" figures. */
  async accountsJoined(from: Date, to: Date) {
    const window = { createdAt: { gte: from, lt: to } };

    const [customers, providers, applications] = await Promise.all([
      this.prisma.customerProfile.count({ where: { deletedAt: null, ...window } }),
      this.prisma.instructorProfile.count({
        where: { deletedAt: null, status: InstructorStatus.ACTIVE, ...window },
      }),
      this.prisma.instructorProfile.count({ where: { deletedAt: null, ...window } }),
    ]);

    return { customers, providers, applications };
  }

  // ------------------------------------------------------------- bookings

  /**
   * The bookings raised in the window, for `ReportsService` to bucket by day.
   *
   * **Deliberately not SQL `date_trunc`.** Prisma's `groupBy` cannot group on
   * an expression, and the raw-SQL version needs an `AT TIME ZONE` argument —
   * but this project has no configured timezone: `common/dates/calendar.ts`
   * defines a day in **server-local** terms and every other date rule follows
   * it. A tz string here would be a second, competing notion of "day" and the
   * report would disagree with the dashboard by one row at the edges.
   *
   * So the bucketing happens in Node, through the same calendar helpers. The
   * cost is loading the window's rows: fine for a 30-day default, and the
   * thing to revisit first if a year-wide report is ever asked for.
   */
  bookingsInRange(from: Date, to: Date): Promise<BookingRangeRow[]> {
    return this.prisma.booking.findMany({
      where: { deletedAt: null, createdAt: { gte: from, lt: to } },
      select: {
        createdAt: true,
        sessionCount: true,
        grossAmount: true,
        discount: true,
        payable: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Range totals, so the footer cannot drift from the rows above it. */
  bookingTotals(from: Date, to: Date) {
    return this.prisma.booking.aggregate({
      where: { deletedAt: null, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { sessionCount: true, grossAmount: true, discount: true, payable: true },
    });
  }

  // ------------------------------------------------------------- payments

  /** Gateway transactions raised in the window: count and total per state. */
  paymentsByState(from: Date, to: Date) {
    return this.prisma.payment.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  /** Refunds are their own table, not a payment state — 6.12 wants both. */
  refundTotals(from: Date, to: Date) {
    return this.prisma.refund.aggregate({
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  // -------------------------------------------------------- session status

  /**
   * Sessions *scheduled* inside the range, grouped by status.
   *
   * `sessionDate` is a `date` column, so the bounds are the calendar days
   * themselves — never instants. This is the one window here that is not
   * built from `createdAt`: 6.12's "booking status totals" asks what was
   * scheduled in the period, not what was booked in it.
   */
  sessionsByStatus(fromDay: Date, toDay: Date) {
    return this.prisma.bookingSession.groupBy({
      by: ['status'],
      where: { sessionDate: { gte: fromDay, lte: toDay } },
      _count: { _all: true },
    });
  }
}
