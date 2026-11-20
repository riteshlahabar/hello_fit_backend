import { Injectable } from '@nestjs/common';
import { formatDateTime } from '../../common/dates/format';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentService } from '../assignment/assignment.service';
import { initialsOf, money, shortNameOf, slotOf } from './trainer-view';

/**
 * Pages 31, 33 and 34 — the provider's accept/reject step (§4.7).
 *
 * Both halves delegate to `AssignmentService`, which owns the state machine:
 * `accept` is mode-agnostic and already correct, and `decline` was taught on
 * 20-11-2026 not to cascade a `DIRECT` request to a different provider. This
 * service is the trainer-app read model over the same rows.
 */
@Injectable()
export class TrainerRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: AssignmentService,
  ) {}

  /** Page 31 — everything still waiting on this trainer's answer. */
  async list(instructorId: string) {
    const rows = await this.prisma.assignment.findMany({
      where: { instructorId, response: 'PENDING' },
      orderBy: { offeredAt: 'desc' },
      select: {
        id: true,
        mode: true,
        offeredAt: true,
        expiresAt: true,
        session: {
          select: {
            id: true,
            sessionDate: true,
            fromMinute: true,
            toMinute: true,
            durationMin: true,
            sessionValue: true,
            service: { select: { name: true } },
            // Area, never the street: the exact address and the masked-call
            // route open only once the request is accepted (spec 10.1).
            address: {
              select: {
                area: { select: { name: true } },
                city: { select: { name: true } },
              },
            },
            booking: {
              select: {
                code: true,
                sessionCount: true,
                participantCount: true,
                preferences: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    trustBand: true,
                    // Page 31 quotes the goal and page 32 lists it; both are
                    // real columns on `CustomerProfile`, and `healthNotes` is
                    // documented as what the teacher must read before
                    // arriving. Neither is masked — spec 10.1 hides identity
                    // and contact, not what the session is for.
                    goal: true,
                    healthNotes: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      data: rows.map(toRequest),
      meta: { count: rows.length },
    };
  }

  /** Page 33 — Accept Booking. The note is optional and lands on the session. */
  async accept(instructorId: string, requestId: string, note?: string) {
    const accepted = await this.assignment.accept(instructorId, requestId);

    if (note?.trim()) {
      await this.prisma.bookingSession.update({
        where: { id: accepted.sessionId },
        data: { notesByInstructor: note.trim() },
      });
    }

    return { requestId, sessionId: accepted.sessionId, response: 'ACCEPTED' };
  }

  /**
   * Page 34 — Reject Booking. The reason is one of the seven the page lists
   * plus the free-text box; both are folded into the single `declineReason`
   * column, because there is no reason master (see
   * `state/open-points/backend-gaps.md`).
   */
  async reject(
    instructorId: string,
    requestId: string,
    reason: string,
    message?: string,
  ) {
    const full = message?.trim() ? `${reason} — ${message.trim()}` : reason;
    const result = await this.assignment.decline(instructorId, requestId, full);

    return { requestId, response: 'REJECTED', cascaded: result.cascaded };
  }
}

function toRequest(row: {
  id: string;
  mode: string;
  offeredAt: Date;
  expiresAt: Date | null;
  session: {
    id: string;
    sessionDate: Date;
    fromMinute: number;
    toMinute: number;
    durationMin: number;
    sessionValue: unknown;
    service: { name: string };
    address: { area: { name: string } | null; city: { name: string } | null };
    booking: {
      code: string;
      sessionCount: number;
      participantCount: number;
      preferences: unknown;
      customer: {
        id: string;
        name: string;
        trustBand: string;
        goal: string | null;
        healthNotes: string | null;
      };
    };
  };
}) {
  const { session } = row;

  return {
    id: row.id,
    sessionId: session.id,
    bookingCode: session.booking.code,
    /** DIRECT = the customer chose this trainer; AUTO = the ranked cascade. */
    mode: row.mode,
    receivedAt: formatDateTime(row.offeredAt),
    expiresAt: row.expiresAt ? formatDateTime(row.expiresAt) : null,
    client: {
      id: session.booking.customer.id,
      name: shortNameOf(session.booking.customer.name),
      initials: initialsOf(session.booking.customer.name),
      trustBand: session.booking.customer.trustBand,
    },
    service: session.service.name,
    slot: slotOf(session),
    persons: session.booking.participantCount,
    sessionCount: session.booking.sessionCount,
    amount: money(session.sessionValue),
    area: [session.address.area?.name, session.address.city?.name]
      .filter(Boolean)
      .join(', '),
    /** Page 31's quoted line, and page 32's "Fitness goals". */
    goal: session.booking.customer.goal,
    healthNotes: session.booking.customer.healthNotes,
    preferences: session.booking.preferences ?? null,
  };
}
