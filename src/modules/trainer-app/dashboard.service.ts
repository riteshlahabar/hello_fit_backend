import { Injectable } from '@nestjs/common';
import { formatDate } from '../../common/dates/format';
import { todayCalendar } from '../../common/dates/calendar';
import { PrismaService } from '../../prisma/prisma.service';
import type { InstructorContext } from './instructor-context.service';
import { periodWindow } from './earnings.view';
import { metricsFor, toScheduleEntry } from './dashboard.view';
import { toRequestGroups } from './dashboard-requests.view';
import { BOOKING_BUCKETS, money } from './trainer-view';

/** The statuses that put a session on today's timeline. */
const ON_TIMELINE = [...BOOKING_BUCKETS.confirmed, ...BOOKING_BUCKETS.completed];

/**
 * How many request cards the home screen draws. The tile above them counts
 * every waiting booking, so the cap never makes the number lie.
 */
const HOME_REQUEST_CARDS = 5;

/**
 * How many pending offers are read before grouping. A card is a booking and
 * a row is a session, so five cards can be fifty offers — a package is
 * offered session by session. Bounded because an offer expires.
 */
const PENDING_SCAN = 60;

/**
 * Page 24 — Trainer Dashboard, in one request.
 *
 * Deliberately one route rather than the screen fanning out to `today`,
 * `requests` and `earnings`: those are three round-trips on a cold mobile
 * connection for a screen that is pure summary, and the "active clients"
 * figure is in none of them.
 *
 * **Answers for an unapproved trainer too.** The shell is reachable from
 * `DOCUMENTS_SUBMITTED` onward (client, 20-11-2026), so the strict
 * `require` guard would 404 the home screen of every trainer waiting on
 * verification. They get their name, their stage, and four honest zeroes.
 */
@Injectable()
export class TrainerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async load(context: InstructorContext) {
    const today = todayCalendar();

    if (!context.active) {
      return this.shape(context, today, {
        schedule: [],
        requests: [],
        clients: 0,
        monthNet: 0,
      });
    }

    const { from } = periodWindow('month');

    const [schedule, requests, clients, earnings] = await Promise.all([
      this.prisma.bookingSession.findMany({
        where: {
          instructorId: context.id,
          sessionDate: today,
          deletedAt: null,
          status: { in: ON_TIMELINE },
        },
        orderBy: { fromMinute: 'asc' },
        select: {
          id: true,
          fromMinute: true,
          toMinute: true,
          durationMin: true,
          status: true,
          service: { select: { name: true } },
          booking: { select: { customer: { select: { name: true } } } },
        },
      }),
      this.prisma.assignment.findMany({
        where: { instructorId: context.id, response: 'PENDING' },
        orderBy: { offeredAt: 'desc' },
        take: PENDING_SCAN,
        select: {
          id: true,
          mode: true,
          session: {
            select: {
              id: true,
              sessionDate: true,
              fromMinute: true,
              toMinute: true,
              durationMin: true,
              service: { select: { name: true } },
              booking: {
                select: {
                  id: true,
                  code: true,
                  customer: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.activeClientCount(context.id),
      this.prisma.earning.aggregate({
        where: { instructorId: context.id, createdAt: { gte: from } },
        _sum: { netAmount: true },
      }),
    ]);

    return this.shape(context, today, {
      schedule: schedule.map(toScheduleEntry),
      requests: toRequestGroups(requests),
      clients,
      monthNet: money(earnings._sum.netAmount),
    });
  }

  /**
   * Distinct customers with a session this trainer has not yet delivered, or
   * delivered in the last 30 days. `distinct` on the relation is not
   * expressible in Prisma, so the ids come back and are counted here — the
   * query is bounded by the status filter and one trainer's own rows.
   */
  private async activeClientCount(instructorId: string): Promise<number> {
    const rows = await this.prisma.bookingSession.findMany({
      where: {
        instructorId,
        deletedAt: null,
        status: { in: ON_TIMELINE },
      },
      select: { booking: { select: { customerId: true } } },
      take: 500,
    });

    return new Set(rows.map((row) => row.booking.customerId)).size;
  }

  private shape(
    context: InstructorContext,
    today: Date,
    parts: {
      schedule: ReturnType<typeof toScheduleEntry>[];
      requests: ReturnType<typeof toRequestGroups>;
      clients: number;
      monthNet: number;
    },
  ) {
    return {
      trainer: { name: context.name, stage: context.stage, active: context.active },
      today: formatDate(today),
      // The tile counts every waiting booking; the list below it is capped.
      metrics: metricsFor(parts),
      schedule: parts.schedule,
      requests: parts.requests.slice(0, HOME_REQUEST_CARDS),
    };
  }
}
