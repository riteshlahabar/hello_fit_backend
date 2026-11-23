import { Injectable } from '@nestjs/common';
import { formatDate } from '../../common/dates/format';
import { todayCalendar } from '../../common/dates/calendar';
import { PrismaService } from '../../prisma/prisma.service';
import type { InstructorContext } from './instructor-context.service';
import { periodWindow } from './earnings.view';
import { metricsFor, toRequestPreview, toScheduleEntry } from './dashboard.view';
import { BOOKING_BUCKETS, money } from './trainer-view';

/** The statuses that put a session on today's timeline. */
const ON_TIMELINE = [...BOOKING_BUCKETS.confirmed, ...BOOKING_BUCKETS.completed];

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
        take: 5,
        select: {
          id: true,
          mode: true,
          session: {
            select: {
              id: true,
              service: { select: { name: true } },
              booking: { select: { customer: { select: { name: true } } } },
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
      requests: requests.map(toRequestPreview),
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
      requests: ReturnType<typeof toRequestPreview>[];
      clients: number;
      monthNet: number;
    },
  ) {
    return {
      trainer: { name: context.name, stage: context.stage, active: context.active },
      today: formatDate(today),
      metrics: metricsFor(parts),
      schedule: parts.schedule,
      requests: parts.requests,
    };
  }
}
