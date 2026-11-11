import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InstructorStatus,
  KycStatus,
  OnboardingStage,
  UserStatus,
} from '../../generated/prisma/enums';

/**
 * The onboarding stages that still need an administrator to act — 6.2's
 * "pending provider applications" — the PDF's word; ours is instructor.
 * APPROVED and REJECTED are decided, so neither is pending.
 */
const PENDING_STAGES = [
  OnboardingStage.APPLIED,
  OnboardingStage.DOCUMENTS_SUBMITTED,
  OnboardingStage.SCREENING_CALL,
  OnboardingStage.DEMO_SESSION,
];

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Account status lives on `User`; the blacklist flag on the profile. */
  async customerCounts() {
    const [total, active, suspended, blocked] = await Promise.all([
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
    ]);

    return { total, active, suspended, blocked };
  }

  async instructorCounts() {
    const [total, active, suspended, pendingApplications, kycPending] =
      await Promise.all([
        this.prisma.instructorProfile.count({ where: { deletedAt: null } }),
        this.prisma.instructorProfile.count({
          where: { deletedAt: null, status: InstructorStatus.ACTIVE },
        }),
        this.prisma.instructorProfile.count({
          where: { deletedAt: null, status: InstructorStatus.SUSPENDED },
        }),
        this.prisma.instructorProfile.count({
          where: { deletedAt: null, onboardingStage: { in: PENDING_STAGES } },
        }),
        this.prisma.instructorProfile.count({
          where: { deletedAt: null, kycStatus: KycStatus.PENDING },
        }),
      ]);

    return { total, active, suspended, pendingApplications, kycPending };
  }

  /** Bookings *raised* in the window, grouped by how they were paid for. */
  bookingsByPaymentStatus(from: Date, to: Date) {
    return this.prisma.booking.groupBy({
      by: ['paymentStatus'],
      where: { deletedAt: null, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
  }

  /**
   * Sessions *scheduled* for the day, grouped by status. `sessionDate` is a
   * `date` column, so it is matched against UTC midnight of the calendar day
   * and never against an instant — see `common/dates/calendar.ts`.
   */
  sessionsByStatus(day: Date) {
    return this.prisma.bookingSession.groupBy({
      by: ['status'],
      where: { sessionDate: day },
      _count: { _all: true },
    });
  }

  /** Gateway transactions raised in the window: count and total per state. */
  paymentsByState(from: Date, to: Date) {
    return this.prisma.payment.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { amount: true },
    });
  }
}
