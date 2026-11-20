import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { toBookingRow, summariseBuckets } from './bookings.view';
import { BOOKING_BUCKETS, type BookingBucket } from './trainer-view';

/** Every status a trainer screen can show — i.e. not an unpaid session. */
const VISIBLE = Object.values(BOOKING_BUCKETS).flat();

const ROW = {
  id: true,
  sessionDate: true,
  fromMinute: true,
  toMinute: true,
  durationMin: true,
  status: true,
  sessionValue: true,
  service: { select: { id: true, name: true } },
  address: {
    select: {
      area: { select: { name: true } },
      city: { select: { name: true } },
    },
  },
  booking: {
    select: {
      id: true,
      code: true,
      participantCount: true,
      customer: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BookingSessionSelect;

/** Pages 30 (All Bookings), 32 (Booking Details) and 37 (Booking History). */
@Injectable()
export class TrainerBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    instructorId: string,
    filter: { status?: BookingBucket | 'all'; q?: string },
  ) {
    const bucket =
      filter.status && filter.status !== 'all' ? filter.status : null;

    const where: Prisma.BookingSessionWhereInput = {
      instructorId,
      deletedAt: null,
      status: { in: bucket ? [...BOOKING_BUCKETS[bucket]] : VISIBLE },
      ...(filter.q ? { OR: searchOn(filter.q) } : {}),
    };

    const [rows, counts] = await Promise.all([
      this.prisma.bookingSession.findMany({
        where,
        orderBy: [{ sessionDate: 'desc' }, { fromMinute: 'desc' }],
        take: 200,
        select: ROW,
      }),
      this.prisma.bookingSession.groupBy({
        by: ['status'],
        where: { instructorId, deletedAt: null, status: { in: VISIBLE } },
        _count: { _all: true },
      }),
    ]);

    return {
      data: rows.map(toBookingRow),
      meta: { count: rows.length, summary: summariseBuckets(counts) },
    };
  }

  /** Page 32 — Booking Details. */
  async detail(instructorId: string, sessionId: string) {
    const row = await this.prisma.bookingSession.findFirst({
      where: { id: sessionId, instructorId, deletedAt: null },
      select: {
        ...ROW,
        notesByInstructor: true,
        booking: {
          select: {
            ...ROW.booking.select,
            sessionCount: true,
            preferences: true,
            // Page 32's "Fitness goals" card. Real columns on
            // `CustomerProfile`; see the same select in `requests.service.ts`.
            customer: {
              select: {
                ...ROW.booking.select.customer.select,
                goal: true,
                healthNotes: true,
              },
            },
          },
        },
        assignments: {
          where: { instructorId },
          orderBy: { offeredAt: 'desc' },
          take: 1,
          select: {
            id: true,
            mode: true,
            response: true,
            declineReason: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Booking not found',
      });
    }

    const offer = row.assignments[0];

    return {
      ...toBookingRow(row),
      sessionCount: row.booking.sessionCount,
      notes: row.notesByInstructor,
      goal: row.booking.customer.goal,
      healthNotes: row.booking.customer.healthNotes,
      /** Gender, language, "same teacher" — whatever the customer asked for. */
      preferences: row.booking.preferences ?? null,
      /** Non-null means this booking still owes the trainer an answer. */
      request: offer
        ? {
            id: offer.id,
            mode: offer.mode,
            response: offer.response,
            reason: offer.declineReason,
          }
        : null,
    };
  }
}

/** Code, client name or service name — the one search box pages 30 and 37 share. */
function searchOn(q: string): Prisma.BookingSessionWhereInput[] {
  return [
    { booking: { code: { contains: q, mode: 'insensitive' } } },
    { booking: { customer: { name: { contains: q, mode: 'insensitive' } } } },
    { service: { name: { contains: q, mode: 'insensitive' } } },
  ];
}
