import { Injectable } from '@nestjs/common';
import { ReportsRepository } from './reports.repository';
import { calendarDayOf, formatCalendarDate } from '../../common/dates/calendar';
import {
  rangeDayKeys,
  rangeMeta,
  resolveRange,
  round2,
} from './report-range';
import type { ReportRangeQueryDto } from './dto/reports.dto';
import { SessionStatus } from '../../generated/prisma/enums';

/** Every session status, in lifecycle order — the report shows all thirteen. */
const ALL_SESSION_STATUSES: readonly SessionStatus[] = [
  SessionStatus.PENDING_PAYMENT,
  SessionStatus.CONFIRMED,
  SessionStatus.ASSIGNED,
  SessionStatus.REASSIGNMENT_NEEDED,
  SessionStatus.EN_ROUTE,
  SessionStatus.IN_PROGRESS,
  SessionStatus.COMPLETED,
  SessionStatus.RESCHEDULE_REQUESTED,
  SessionStatus.CANCELLED_BY_CUSTOMER,
  SessionStatus.CANCELLED_BY_TEACHER,
  SessionStatus.CANCELLED_BY_ADMIN,
  SessionStatus.NO_SHOW_CUSTOMER,
  SessionStatus.NO_SHOW_TEACHER,
];

/**
 * Reports (PDF 6.12, US-A12). Read-only, four reports, one shared range —
 * which lives in `report-range.ts`, not here.
 *
 * **No export.** 6.12 grants it "only where explicitly included in the agreed
 * report requirements", and no such requirements exist yet. The seeded
 * `reports:export` permission is unused on purpose; a CSV button would be
 * inventing scope.
 *
 * **Not shared with the dashboard.** 6.2 answers one day with live totals;
 * this answers a chosen range. Same tables, different question — merging them
 * would give one of the two screens a window it never asked for.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  /** 6.12's "customer and provider summaries": totals now, plus new in range. */
  async customersAndProviders(query: ReportRangeQueryDto) {
    const range = resolveRange(query);

    const [totals, joined] = await Promise.all([
      this.repo.accountTotals(),
      this.repo.accountsJoined(range.start, range.end),
    ]);

    return {
      range: rangeMeta(range),
      customers: {
        total: totals.customers,
        active: totals.activeCustomers,
        suspended: totals.suspendedCustomers,
        blocked: totals.blockedCustomers,
        newInRange: joined.customers,
      },
      providers: {
        total: totals.providers,
        active: totals.activeProviders,
        pendingApplications: totals.pendingApplications,
        kycPending: totals.kycPending,
        newApplicationsInRange: joined.applications,
        newApprovedInRange: joined.providers,
      },
    };
  }

  /**
   * 6.12's "booking summaries": one row per calendar day, plus range totals.
   *
   * Days with no bookings are **included as zero rows** — a gap in the table
   * reads as missing data, where a zero reads as a quiet day.
   *
   * `totals` comes from its own `aggregate` rather than summing the rows, so
   * if the two ever disagree the bug is visible instead of hidden.
   */
  async bookings(query: ReportRangeQueryDto) {
    const range = resolveRange(query);

    const [rows, totals] = await Promise.all([
      this.repo.bookingsInRange(range.start, range.end),
      this.repo.bookingTotals(range.start, range.end),
    ]);

    const buckets = new Map(
      rangeDayKeys(range).map((date) => [
        date,
        { bookings: 0, sessions: 0, gross: 0, discount: 0 },
      ]),
    );

    for (const row of rows) {
      // `createdAt` is an instant; the day it belongs to is the local one.
      const bucket = buckets.get(formatCalendarDate(calendarDayOf(row.createdAt)));

      if (!bucket) continue;

      bucket.bookings += 1;
      bucket.sessions += row.sessionCount;
      bucket.gross += Number(row.grossAmount);
      bucket.discount += Number(row.discount);
    }

    const gross = Number(totals._sum.grossAmount ?? 0);
    const discount = Number(totals._sum.discount ?? 0);

    return {
      range: rangeMeta(range),
      rows: [...buckets.entries()].map(([date, b]) => ({
        date,
        bookings: b.bookings,
        sessions: b.sessions,
        gross: round2(b.gross),
        discount: round2(b.discount),
        net: round2(b.gross - b.discount),
      })),
      totals: {
        bookings: totals._count._all,
        sessions: totals._sum.sessionCount ?? 0,
        gross: round2(gross),
        discount: round2(discount),
        net: round2(gross - discount),
        payable: round2(Number(totals._sum.payable ?? 0)),
      },
    };
  }

  /** 6.12's "payment summaries where data is available": per state, + refunds. */
  async payments(query: ReportRangeQueryDto) {
    const range = resolveRange(query);

    const [states, refunds] = await Promise.all([
      this.repo.paymentsByState(range.start, range.end),
      this.repo.refundTotals(range.start, range.end),
    ]);

    const rows = states.map((state) => ({
      status: state.status,
      count: state._count._all,
      amount: round2(Number(state._sum.amount ?? 0)),
    }));

    return {
      range: rangeMeta(range),
      rows,
      // Refunds are their own table, not a gateway state, so they are their
      // own line rather than a row that would double-count the total.
      refunds: {
        count: refunds._count._all,
        amount: round2(Number(refunds._sum.amount ?? 0)),
      },
      totals: {
        count: rows.reduce((sum, r) => sum + r.count, 0),
        amount: round2(rows.reduce((sum, r) => sum + r.amount, 0)),
      },
    };
  }

  /**
   * 6.12's "relevant booking status totals" — sessions **scheduled** in the
   * range, by status.
   *
   * All thirteen, each with its share. The dashboard rolls the three
   * cancellations and two no-shows up into two tiles because a tile is a
   * glance; a report is where "who cancelled" is the question being asked,
   * so nothing is rolled up here.
   */
  async bookingStatus(query: ReportRangeQueryDto) {
    const range = resolveRange(query);
    const grouped = await this.repo.sessionsByStatus(range.fromDay, range.toDay);

    const counts = new Map(grouped.map((g) => [g.status, g._count._all]));
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

    return {
      range: rangeMeta(range),
      total,
      rows: ALL_SESSION_STATUSES.map((status) => {
        const sessions = counts.get(status) ?? 0;

        return {
          status,
          sessions,
          // Guarded: an empty range must read 0%, not NaN.
          percent: total === 0 ? 0 : round2((sessions / total) * 100),
        };
      }),
    };
  }
}
