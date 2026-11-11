import { Injectable } from '@nestjs/common';
import {
  addCalendarDays,
  formatCalendarDate,
  parseCalendarDate,
  sessionStartsAt,
  todayCalendar,
} from '../../common/dates/calendar';
import {
  PaymentState,
  PaymentStatus,
  SessionStatus,
} from '../../generated/prisma/enums';
import { DashboardRepository } from './dashboard.repository';
import type { DashboardSummaryQueryDto } from './dto/dashboard.dto';

/**
 * The six session statuses the dashboard shows — client instruction,
 * 11 Nov 2026: "main status only". `SessionStatus` has thirteen members, and
 * the three cancellation variants and two no-show variants are rolled up,
 * because who cancelled is a question for the booking screen's filter, not for
 * a count tile. The statuses left out are the transient ones
 * (PENDING_PAYMENT, EN_ROUTE, REASSIGNMENT_NEEDED, RESCHEDULE_REQUESTED).
 */
const MAIN_SESSION_STATUSES = {
  confirmed: [SessionStatus.CONFIRMED],
  assigned: [SessionStatus.ASSIGNED],
  inProgress: [SessionStatus.IN_PROGRESS],
  completed: [SessionStatus.COMPLETED],
  cancelled: [
    SessionStatus.CANCELLED_BY_CUSTOMER,
    SessionStatus.CANCELLED_BY_TEACHER,
    SessionStatus.CANCELLED_BY_ADMIN,
  ],
  noShow: [SessionStatus.NO_SHOW_CUSTOMER, SessionStatus.NO_SHOW_TEACHER],
} as const;

@Injectable()
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  /**
   * One aggregate behind 6.2's seven bullets. Every value is counted in the
   * database — the screen does no arithmetic of its own.
   */
  async summary(query: DashboardSummaryQueryDto) {
    const day = query.date ? parseCalendarDate(query.date) : todayCalendar();
    // Bookings and payments carry instants, so the calendar day becomes a
    // local-midnight-to-local-midnight window; sessions match the day itself.
    const from = sessionStartsAt(day, 0);
    const to = sessionStartsAt(addCalendarDays(day, 1), 0);

    const [customers, instructors, bookingRows, sessionRows, paymentRows] =
      await Promise.all([
        this.repo.customerCounts(),
        this.repo.instructorCounts(),
        this.repo.bookingsByPaymentStatus(from, to),
        this.repo.sessionsByStatus(day),
        this.repo.paymentsByState(from, to),
      ]);

    const byPaymentStatus = Object.fromEntries(
      Object.values(PaymentStatus).map((status) => [
        status,
        bookingRows.find((r) => r.paymentStatus === status)?._count._all ?? 0,
      ]),
    ) as Record<PaymentStatus, number>;

    const countOf = (statuses: readonly SessionStatus[]) =>
      statuses.reduce(
        (sum, status) =>
          sum +
          (sessionRows.find((r) => r.status === status)?._count._all ?? 0),
        0,
      );

    const byStatus = Object.fromEntries(
      Object.entries(MAIN_SESSION_STATUSES).map(([key, statuses]) => [
        key,
        countOf(statuses),
      ]),
    ) as Record<keyof typeof MAIN_SESSION_STATUSES, number>;

    const payments = Object.fromEntries(
      Object.values(PaymentState).map((state) => {
        const row = paymentRows.find((r) => r.status === state);
        return [
          state,
          { count: row?._count._all ?? 0, amount: row?._sum.amount ?? 0 },
        ];
      }),
    ) as Record<PaymentState, { count: number; amount: unknown }>;

    return {
      date: formatCalendarDate(day),
      customers,
      instructors,
      bookings: {
        // Raised on the day, whatever their payment state.
        total: bookingRows.reduce((sum, r) => sum + r._count._all, 0),
        byPaymentStatus,
      },
      sessions: {
        // Scheduled for the day, including the statuses not tiled above.
        total: sessionRows.reduce((sum, r) => sum + r._count._all, 0),
        byStatus,
      },
      payments,
    };
  }
}
