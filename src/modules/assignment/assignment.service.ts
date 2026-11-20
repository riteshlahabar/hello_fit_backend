import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { haversineKm } from '../../common/geo/distance';
import { calendarWeekday } from '../../common/dates/calendar';
import { AvailabilityService } from '../availability/availability.service';
import {
  rankCandidates,
  type Candidate,
  type RejectionReason,
} from './matching.calculator';

/** Statuses from which a session can still be offered to a teacher. */
const OFFERABLE = ['CONFIRMED', 'REASSIGNMENT_NEEDED'] as const;

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Ranks eligible teachers for a session and offers it to the best match
   * (spec 3.3). Returns the offer, or null when nobody is eligible — in which
   * case the session stays in the admin assignment queue with the rejection
   * reasons recorded for support to read.
   */
  async offerNextCandidate(sessionId: string) {
    const policy = this.settings.get('assignment');

    const session = await this.loadSessionForMatching(sessionId);

    if (!OFFERABLE.includes(session.status as (typeof OFFERABLE)[number])) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Session is ${session.status} and cannot be offered`,
      });
    }

    // Teachers already asked for this session are skipped, so the cascade
    // moves forward rather than looping on the same person.
    const alreadyOffered = await this.prisma.assignment.findMany({
      where: { sessionId },
      select: { instructorId: true, response: true },
    });

    const exhausted = alreadyOffered.length >= policy.maxCascadeAttempts;

    if (exhausted) {
      this.logger.warn(
        `Session ${sessionId}: ${alreadyOffered.length} offers exhausted, leaving for admin`,
      );
      return null;
    }

    const { ranked, rejected } = await this.rankFor(
      session,
      alreadyOffered.map((o) => o.instructorId),
    );

    if (ranked.length === 0) {
      this.logger.warn(
        `Session ${sessionId}: no eligible teacher. Reasons: ${summarise(rejected)}`,
      );
      return null;
    }

    const best = ranked[0];
    const expiresAt = new Date(
      Date.now() + policy.offerTimeoutMinutes * 60_000,
    );

    const offer = await this.prisma.assignment.create({
      data: {
        sessionId,
        instructorId: best.instructorId,
        mode: 'AUTO',
        expiresAt,
        response: 'PENDING',
        // Kept so a disputed assignment can be explained months later.
        scoreSnapshot: {
          score: best.score,
          components: best.components,
          weights: { ...policy.weights },
          rankedCount: ranked.length,
          rejected: rejected.slice(0, 10),
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Session ${sessionId} offered to ${best.instructorId} (score ${best.score}), expires ${expiresAt.toISOString()}`,
    );

    return offer;
  }

  /** Teacher accepts an offer (spec 6.3, Requests tab). */
  async accept(instructorId: string, offerId: string) {
    const offer = await this.prisma.assignment.findFirst({
      where: { id: offerId, instructorId },
      include: { session: true },
    });

    if (!offer) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Offer not found',
      });
    }

    if (offer.response !== 'PENDING') {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: `This offer was already ${offer.response.toLowerCase()}`,
      });
    }

    if (offer.expiresAt && offer.expiresAt < new Date()) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'This offer has expired',
      });
    }

    // The teacher may have been assigned something else since the offer was
    // made, so the clash check runs again at the moment of acceptance.
    const free = await this.availability.isSlotStillFree({
      instructorId,
      date: offer.session.sessionDate,
      fromMinute: offer.session.fromMinute,
      toMinute: offer.session.toMinute,
      excludeSessionId: offer.sessionId,
    });

    if (!free) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: 'You now have a clashing session for this slot',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id: offerId },
        data: { response: 'ACCEPTED', respondedAt: new Date() },
      });

      await tx.bookingSession.update({
        where: { id: offer.sessionId },
        data: { instructorId, status: 'ASSIGNED' },
      });

      // Any other pending offer for this session is now moot.
      await tx.assignment.updateMany({
        where: {
          sessionId: offer.sessionId,
          id: { not: offerId },
          response: 'PENDING',
        },
        data: { response: 'CANCELLED', respondedAt: new Date() },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: offer.session.bookingId,
          sessionId: offer.sessionId,
          fromStatus: offer.session.status,
          toStatus: 'ASSIGNED',
          actorType: 'INSTRUCTOR',
          actorId: instructorId,
          reason: 'Offer accepted',
        },
      });

      return updated;
    });
  }

  /**
   * Offers a session to the teacher the **customer chose** (§3.6, §4.7).
   *
   * Not a ranked offer: there is nothing to rank, the customer has already
   * picked. The session keeps its `instructorId` so the slot stays held while
   * the request waits, and stays `CONFIRMED` — `todayForInstructor` only
   * lists `ASSIGNED` and later, so an unanswered request never appears on
   * anybody's timeline.
   *
   * `expiresAt` is deliberately null. An auto offer times out so the cascade
   * can move on; a direct request has nowhere to cascade to, and silently
   * expiring the provider the customer picked would substitute someone else
   * behind both their backs. It waits for an answer, and shows in the admin
   * queue meanwhile.
   */
  async offerDirect(sessionId: string, instructorId: string) {
    const existing = await this.prisma.assignment.findFirst({
      where: { sessionId, instructorId, response: 'PENDING' },
      select: { id: true },
    });

    if (existing) return existing;

    const offer = await this.prisma.assignment.create({
      data: { sessionId, instructorId, mode: 'DIRECT', response: 'PENDING' },
    });

    this.logger.log(
      `Session ${sessionId} requested directly from ${instructorId} (customer's choice)`,
    );

    return offer;
  }

  /**
   * Teacher declines. A reason is mandatory because it feeds the reliability
   * score (spec 6.3), and the session immediately cascades to the next match.
   *
   * **Except a `DIRECT` request** (§4.7): the customer picked this provider,
   * so there is no next match to fall to. The teacher is detached and the
   * session goes to `REASSIGNMENT_NEEDED`, where ops or the customer chooses
   * again — the platform never swaps in a different provider on its own.
   */
  async decline(instructorId: string, offerId: string, reason: string) {
    const offer = await this.prisma.assignment.findFirst({
      where: { id: offerId, instructorId },
      include: { session: true },
    });

    if (!offer) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Offer not found',
      });
    }

    if (offer.response !== 'PENDING') {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: `This offer was already ${offer.response.toLowerCase()}`,
      });
    }

    await this.prisma.assignment.update({
      where: { id: offerId },
      data: {
        response: 'DECLINED',
        declineReason: reason,
        respondedAt: new Date(),
      },
    });

    if (offer.mode === 'DIRECT') {
      await this.releaseDirect(offer, instructorId, reason);
      return { declined: true, cascaded: false };
    }

    await this.cascade(offer.sessionId);

    return { declined: true, cascaded: true };
  }

  /**
   * Detaches the provider a customer picked and parks the session for ops.
   * `cascade` is not called: see [decline].
   */
  private async releaseDirect(
    offer: { sessionId: string; session: { bookingId: string; status: string } },
    instructorId: string,
    reason: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.bookingSession.update({
        where: { id: offer.sessionId },
        data: { instructorId: null, status: 'REASSIGNMENT_NEEDED' },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: offer.session.bookingId,
          sessionId: offer.sessionId,
          fromStatus: offer.session.status as 'CONFIRMED',
          toStatus: 'REASSIGNMENT_NEEDED',
          actorType: 'INSTRUCTOR',
          actorId: instructorId,
          reason: `Request rejected: ${reason}`,
        },
      });
    });

    this.logger.warn(
      `Session ${offer.sessionId}: direct request rejected by ${instructorId}, left for admin`,
    );
  }

  /**
   * Admin override — assign or reassign any teacher with a reason, notifying
   * both sides (spec 3.3). Bypasses the score but not the clash check: a
   * double-booked teacher is an operational failure, not a judgement call.
   */
  async adminAssign(params: {
    sessionId: string;
    instructorId: string;
    adminUserId: string;
    reason: string;
    /** Allow assigning over a clash, recorded on the assignment. */
    force?: boolean;
  }) {
    const session = await this.prisma.bookingSession.findFirst({
      where: { id: params.sessionId, deletedAt: null },
    });

    if (!session) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
    }

    if (!params.force) {
      const free = await this.availability.isSlotStillFree({
        instructorId: params.instructorId,
        date: session.sessionDate,
        fromMinute: session.fromMinute,
        toMinute: session.toMinute,
        excludeSessionId: session.id,
      });

      if (!free) {
        throw new ConflictException({
          code: ErrorCode.DUPLICATE_RESOURCE,
          message:
            'That teacher is not available for this slot. Pass force to override.',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.assignment.create({
        data: {
          sessionId: params.sessionId,
          instructorId: params.instructorId,
          mode: 'MANUAL',
          response: 'ACCEPTED',
          respondedAt: new Date(),
          assignedById: params.adminUserId,
          scoreSnapshot: { manual: true, forced: Boolean(params.force) },
        },
      });

      await tx.assignment.updateMany({
        where: {
          sessionId: params.sessionId,
          id: { not: assignment.id },
          response: 'PENDING',
        },
        data: { response: 'CANCELLED', respondedAt: new Date() },
      });

      await tx.bookingSession.update({
        where: { id: params.sessionId },
        data: { instructorId: params.instructorId, status: 'ASSIGNED' },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: session.bookingId,
          sessionId: params.sessionId,
          fromStatus: session.status,
          toStatus: 'ASSIGNED',
          actorType: 'ADMIN',
          actorId: params.adminUserId,
          reason: params.reason,
          remark: params.force ? 'Forced over a clash' : null,
        },
      });

      return assignment;
    });
  }

  /** Offers waiting on this teacher, newest first (Requests tab). */
  async listOffersForInstructor(instructorId: string) {
    return this.prisma.assignment.findMany({
      where: { instructorId, response: 'PENDING' },
      orderBy: { offeredAt: 'desc' },
      select: {
        id: true,
        offeredAt: true,
        expiresAt: true,
        mode: true,
        session: {
          select: {
            id: true,
            sessionDate: true,
            fromMinute: true,
            toMinute: true,
            durationMin: true,
            sessionValue: true,
            service: { select: { name: true } },
            // Area only, not the full address: the customer's exact location
            // and phone stay hidden until the offer is accepted (spec 10.1).
            address: {
              select: {
                area: { select: { name: true } },
                city: { select: { name: true } },
              },
            },
            booking: {
              select: {
                customer: { select: { trustBand: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * The admin assignment queue: sessions that are paid but have no teacher
   * (spec 5.4).
   */
  async listAssignmentQueue() {
    return this.prisma.bookingSession.findMany({
      where: {
        deletedAt: null,
        instructorId: null,
        status: { in: [...OFFERABLE] },
      },
      orderBy: [{ sessionDate: 'asc' }, { fromMinute: 'asc' }],
      select: {
        id: true,
        sessionDate: true,
        fromMinute: true,
        toMinute: true,
        status: true,
        service: { select: { name: true } },
        booking: { select: { code: true } },
        address: {
          select: {
            pincode: true,
            area: { select: { name: true } },
          },
        },
        assignments: {
          orderBy: { offeredAt: 'desc' },
          select: {
            instructorId: true,
            response: true,
            declineReason: true,
            offeredAt: true,
          },
        },
      },
    });
  }

  /** Candidate list with scores, for the admin "who can take this?" screen. */
  async candidatesFor(sessionId: string) {
    const session = await this.loadSessionForMatching(sessionId);
    const { ranked, rejected } = await this.rankFor(session, []);

    const names = await this.prisma.instructorProfile.findMany({
      where: { id: { in: ranked.map((r) => r.instructorId) } },
      select: { id: true, name: true, ratingAvg: true, photoUrl: true },
    });

    const byId = new Map(names.map((n) => [n.id, n]));

    return {
      eligible: ranked.map((r) => ({ ...r, instructor: byId.get(r.instructorId) })),
      rejected,
    };
  }

  /** Moves a session to the next candidate, or leaves it for admin. */
  async cascade(sessionId: string) {
    const session = await this.prisma.bookingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, bookingId: true, instructorId: true },
    });

    if (!session || session.instructorId) return null;

    // Mark it as needing reassignment so it shows in the admin queue even if
    // the next offer cannot be made.
    if (session.status === 'CONFIRMED') {
      await this.prisma.bookingSession.update({
        where: { id: sessionId },
        data: { status: 'REASSIGNMENT_NEEDED' },
      });
    }

    return this.offerNextCandidate(sessionId).catch((error) => {
      this.logger.error(
        `Cascade failed for session ${sessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    });
  }

  // -------------------------------------------------------------------------

  private async loadSessionForMatching(sessionId: string) {
    const session = await this.prisma.bookingSession.findFirst({
      where: { id: sessionId, deletedAt: null },
      include: {
        address: { select: { areaId: true, lat: true, lng: true } },
        booking: {
          select: {
            customerId: true,
            preferences: true,
            service: { select: { id: true, categoryId: true } },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
    }

    return session;
  }

  /**
   * Builds the Candidate list from the database and hands it to the pure
   * matching calculator. All the policy lives in the calculator; this method
   * only gathers facts.
   */
  private async rankFor(
    session: Awaited<ReturnType<AssignmentService['loadSessionForMatching']>>,
    excludeInstructorIds: string[],
  ) {
    const policy = this.settings.get('assignment');
    const scheduling = this.settings.get('scheduling');
    const preferences = (session.booking.preferences ?? {}) as {
      language?: string;
      gender?: string;
    };

    const rows = await this.prisma.instructorProfile.findMany({
      where: {
        deletedAt: null,
        ...(excludeInstructorIds.length
          ? { id: { notIn: excludeInstructorIds } }
          : {}),
      },
      select: {
        id: true,
        status: true,
        kycStatus: true,
        gender: true,
        languages: true,
        ratingAvg: true,
        ratingCount: true,
        reliabilityScore: true,
        travelRadiusKm: true,
        travelBufferMin: true,
        dailySessionCap: true,
        homeBaseLat: true,
        homeBaseLng: true,
        instructorServices: {
          where: { serviceId: session.serviceId, isActive: true, deletedAt: null },
          select: { id: true },
        },
        instructorServiceAreas: session.address.areaId
          ? { where: { areaId: session.address.areaId }, select: { id: true } }
          : { select: { id: true }, take: 0 },
        availabilityRules: {
          where: {
            isActive: true,
            deletedAt: null,
            weekday: calendarWeekday(session.sessionDate),
            effectiveFrom: { lte: session.sessionDate },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: session.sessionDate } },
            ],
          },
          select: { startMinute: true, endMinute: true },
        },
        leaves: {
          where: {
            status: 'APPROVED',
            fromDate: { lte: session.sessionDate },
            toDate: { gte: session.sessionDate },
          },
          select: { id: true },
        },
        bookingSessions: {
          where: {
            sessionDate: session.sessionDate,
            deletedAt: null,
            id: { not: session.id },
            status: {
              in: ['CONFIRMED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'],
            },
          },
          select: { fromMinute: true, toMinute: true },
        },
      },
    });

    // How many sessions each candidate has already taught this customer,
    // for the continuity component.
    const history = await this.prisma.bookingSession.groupBy({
      by: ['instructorId'],
      where: {
        status: 'COMPLETED',
        deletedAt: null,
        booking: { customerId: session.booking.customerId },
        instructorId: { not: null },
      },
      _count: { _all: true },
    });

    const historyById = new Map(
      history.map((h) => [h.instructorId as string, h._count._all]),
    );

    const addressPoint =
      session.address.lat !== null && session.address.lng !== null
        ? { lat: Number(session.address.lat), lng: Number(session.address.lng) }
        : null;

    const candidates: Candidate[] = rows.map((row) => {
      const buffer = row.travelBufferMin ?? scheduling.defaultTravelBufferMin;

      const hasClash = row.bookingSessions.some(
        (busy) =>
          session.fromMinute - buffer < busy.toMinute &&
          busy.fromMinute - buffer < session.toMinute,
      );

      const availabilityCovers = row.availabilityRules.some(
        (rule) =>
          rule.startMinute <= session.fromMinute &&
          rule.endMinute >= session.toMinute,
      );

      // With no coordinates on either side, distance cannot be scored, so the
      // teacher's own radius is used as a neutral value rather than excluding
      // them outright.
      const distanceKm =
        addressPoint && row.homeBaseLat !== null && row.homeBaseLng !== null
          ? haversineKm(addressPoint, {
              lat: Number(row.homeBaseLat),
              lng: Number(row.homeBaseLng),
            })
          : 0;

      return {
        instructorId: row.id,
        isActive: row.status === 'ACTIVE',
        kycVerified: row.kycStatus === 'VERIFIED',
        offersService: row.instructorServices.length > 0,
        servesArea: row.instructorServiceAreas.length > 0,
        availabilityCovers,
        hasClash,
        onLeave: row.leaves.length > 0,
        sessionsToday: row.bookingSessions.length,
        dailySessionCap: row.dailySessionCap,
        distanceKm,
        travelRadiusKm: row.travelRadiusKm,
        ratingAvg: Number(row.ratingAvg),
        ratingCount: row.ratingCount,
        reliabilityScore: Number(row.reliabilityScore),
        languages: row.languages,
        gender: row.gender,
        pastSessionsWithCustomer: historyById.get(row.id) ?? 0,
      };
    });

    return rankCandidates(
      candidates,
      {
        preferredLanguage: preferences.language,
        preferredGender: preferences.gender,
      },
      policy,
    );
  }
}

const summarise = (
  rejected: Array<{ instructorId: string; reason: RejectionReason }>,
): string => {
  const counts = new Map<string, number>();
  for (const r of rejected) {
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
};
