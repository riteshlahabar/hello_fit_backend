import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDate } from '../../common/dates/format';
import { formatClock } from '../../common/dates/clock';

/**
 * The values every booking-lifecycle notification needs, loaded once.
 *
 * Every emitter in the domain modules wants the same half-dozen things: who
 * the two parties are, the booking code, and the slot as a human reads it.
 * Loading that in each of them would mean five near-identical queries and five
 * chances to format a date the wrong way — hard rule 4 says `dd-mm-yyyy`
 * everywhere a person reads one, and a push body is read by a person.
 *
 * Ids come back as **profile** ids, which is what `NotificationService.emit`
 * takes: it resolves `customerId` / `instructorId` to their `User` itself.
 */
export interface SessionNotificationContext {
  sessionId: string;
  bookingId: string;
  bookingCode: string;
  /** `CustomerProfile.id` — never the `User.id`. */
  customerId: string;
  /** `InstructorProfile.id`, null while the session is unassigned. */
  instructorId: string | null;
  customerName: string;
  instructorName: string | null;
  serviceName: string;
  /** `dd-mm-yyyy`. */
  sessionDate: string;
  /** `HH:mm`. */
  fromTime: string;
  toTime: string;
  /** Area then city, for the offer card. The street is never in a push. */
  areaName: string;
}

@Injectable()
export class NotificationContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** One session's parties and slot, or null if it is gone. */
  async forSession(
    sessionId: string,
  ): Promise<SessionNotificationContext | null> {
    const session = await this.prisma.bookingSession.findFirst({
      where: { id: sessionId },
      select: {
        id: true,
        bookingId: true,
        sessionDate: true,
        fromMinute: true,
        toMinute: true,
        instructorId: true,
        service: { select: { name: true } },
        instructor: { select: { name: true } },
        address: {
          select: {
            area: { select: { name: true } },
            city: { select: { name: true } },
          },
        },
        booking: {
          select: {
            code: true,
            customerId: true,
            customer: { select: { name: true } },
          },
        },
      },
    });

    if (!session) return null;

    return {
      sessionId: session.id,
      bookingId: session.bookingId,
      bookingCode: session.booking.code,
      customerId: session.booking.customerId,
      instructorId: session.instructorId,
      customerName: session.booking.customer.name,
      instructorName: session.instructor?.name ?? null,
      serviceName: session.service.name,
      sessionDate: formatDate(session.sessionDate),
      fromTime: formatClock(session.fromMinute),
      toTime: formatClock(session.toMinute),
      areaName: [session.address.area?.name, session.address.city?.name]
        .filter(Boolean)
        .join(', '),
    };
  }

  /**
   * A booking's code and owner plus its **first** session's slot.
   *
   * A package booking has many sessions and one confirmation message; the
   * first occurrence is the one the copy quotes, which is what the customer
   * is waiting to see.
   */
  async forBooking(bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId },
      select: {
        id: true,
        code: true,
        customerId: true,
        payable: true,
        sessions: {
          orderBy: { sequence: 'asc' },
          take: 1,
          select: { sessionDate: true, fromMinute: true },
        },
      },
    });

    if (!booking) return null;

    const first = booking.sessions[0];

    return {
      bookingId: booking.id,
      bookingCode: booking.code,
      customerId: booking.customerId,
      payable: Number(booking.payable),
      sessionDate: first ? formatDate(first.sessionDate) : '',
      fromTime: first ? formatClock(first.fromMinute) : '',
    };
  }
}
