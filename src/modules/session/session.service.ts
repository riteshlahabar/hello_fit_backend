import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { haversineKm } from '../../common/geo/distance';
import {
  calendarDayOf,
  sessionStartsAt,
  todayCalendar,
} from '../../common/dates/calendar';
import {
  computeEarning,
  resolveCommissionRule,
  type CommissionRuleLike,
} from '../payout/commission.calculator';

/** How close the teacher must be for the geo-fence to pass (spec 3.4). */
const GEOFENCE_METRES = 300;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Today's timeline for the teacher (spec 6.3, Today tab). */
  async todayForInstructor(instructorId: string, date?: Date) {
    const day = date ? calendarDayOf(date) : todayCalendar();

    return this.prisma.bookingSession.findMany({
      where: {
        instructorId,
        sessionDate: day,
        deletedAt: null,
        status: {
          in: ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'],
        },
      },
      orderBy: { fromMinute: 'asc' },
      select: {
        id: true,
        sessionDate: true,
        fromMinute: true,
        toMinute: true,
        durationMin: true,
        status: true,
        sessionValue: true,
        notesByInstructor: true,
        service: { select: { name: true, instructions: true } },
        checkIn: {
          select: { checkInAt: true, checkOutAt: true, geoVerified: true },
        },
        address: {
          select: {
            line1: true,
            line2: true,
            landmark: true,
            pincode: true,
            accessNotes: true,
            lat: true,
            lng: true,
            area: { select: { name: true } },
          },
        },
        booking: {
          select: {
            code: true,
            customer: {
              select: {
                // First name only until the session starts; the full contact
                // route is the masked-calling service (spec 10.1).
                name: true,
                goal: true,
                healthNotes: true,
                trustBand: true,
              },
            },
          },
        },
      },
    });
  }

  /** Teacher taps "Start travel" — customer sees live status (spec 3.4). */
  async startTravel(instructorId: string, sessionId: string) {
    const session = await this.requireOwnSession(instructorId, sessionId);

    if (session.status !== 'ASSIGNED') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Cannot start travel from status ${session.status}`,
      });
    }

    return this.transition(session, 'EN_ROUTE', {
      actorType: 'INSTRUCTOR',
      actorId: instructorId,
      reason: 'Travel started',
    });
  }

  /**
   * OTP check-in at the customer's door. A geo-fence mismatch does not block
   * check-in — the teacher may legitimately be in a basement or the GPS may
   * be poor — but it requires a reason and is flagged to operations.
   */
  async checkIn(
    instructorId: string,
    sessionId: string,
    input: { otp: string; lat?: number; lng?: number; overrideReason?: string },
  ) {
    const session = await this.requireOwnSession(instructorId, sessionId, {
      address: { select: { lat: true, lng: true } },
    });

    if (!['ASSIGNED', 'EN_ROUTE'].includes(session.status)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Cannot check in from status ${session.status}`,
      });
    }

    const existing = await this.prisma.checkIn.findUnique({
      where: { sessionId },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: 'Already checked in for this session',
      });
    }

    if (!session.checkInOtp || session.checkInOtp !== input.otp) {
      throw new BadRequestException({
        code: ErrorCode.OTP_INVALID,
        message: 'Incorrect check-in code',
      });
    }

    const address = (session as { address?: { lat: unknown; lng: unknown } })
      .address;

    const distanceKm =
      input.lat !== undefined &&
      input.lng !== undefined &&
      address?.lat != null &&
      address?.lng != null
        ? haversineKm(
            { lat: input.lat, lng: input.lng },
            { lat: Number(address.lat), lng: Number(address.lng) },
          )
        : null;

    const geoVerified =
      distanceKm !== null && distanceKm * 1000 <= GEOFENCE_METRES;

    if (!geoVerified && !input.overrideReason) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'You appear to be away from the customer address. Provide a reason to check in anyway.',
        details: { distanceKm },
      });
    }

    // Minutes late against the scheduled start, for the punctuality metric.
    const now = new Date();
    const scheduledStart = sessionStartsAt(
      session.sessionDate,
      session.fromMinute,
    );
    const lateMinutes = Math.max(
      0,
      Math.round((now.getTime() - scheduledStart.getTime()) / 60_000),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const checkIn = await tx.checkIn.create({
        data: {
          sessionId,
          instructorId,
          checkInAt: now,
          checkInLat: input.lat,
          checkInLng: input.lng,
          geoVerified,
          otpUsed: true,
          lateMinutes,
          overrideReason: geoVerified ? null : input.overrideReason,
        },
      });

      await tx.bookingSession.update({
        where: { id: sessionId },
        data: { status: 'IN_PROGRESS' },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: session.bookingId,
          sessionId,
          fromStatus: session.status,
          toStatus: 'IN_PROGRESS',
          actorType: 'INSTRUCTOR',
          actorId: instructorId,
          reason: 'Checked in',
          remark: geoVerified
            ? null
            : `Geo-fence mismatch (${distanceKm ?? 'no fix'} km): ${input.overrideReason}`,
        },
      });

      return checkIn;
    });

    if (!geoVerified) {
      this.logger.warn(
        `Session ${sessionId}: check-in outside geo-fence (${distanceKm ?? 'no fix'} km) — flagged for ops`,
      );
    }

    return { ...result, lateMinutes, geoVerified, distanceKm };
  }

  /**
   * Check-out completes the session, which is the event that creates the
   * earning row, so commission is resolved here (spec 3.7).
   */
  async checkOut(
    instructorId: string,
    sessionId: string,
    input: { notes?: string },
  ) {
    const session = await this.requireOwnSession(instructorId, sessionId);

    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Cannot check out from status ${session.status}`,
      });
    }

    const checkIn = await this.prisma.checkIn.findUnique({
      where: { sessionId },
    });

    if (!checkIn) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'No check-in found for this session',
      });
    }

    const now = new Date();
    const actualDurationMin = Math.max(
      1,
      Math.round((now.getTime() - checkIn.checkInAt.getTime()) / 60_000),
    );

    return this.completeSession({
      session,
      instructorId,
      completedAt: now,
      actualDurationMin,
      notes: input.notes,
      actorType: 'INSTRUCTOR',
      reason: 'Checked out',
    });
  }

  /**
   * Shared completion path for check-out and the auto-complete cron. Creating
   * the earning and flipping the status happen in one transaction so a
   * completed session can never exist without its earning row.
   */
  async completeSession(params: {
    session: {
      id: string;
      bookingId: string;
      status: string;
      serviceId: string;
      sessionValue: unknown;
    };
    instructorId: string;
    completedAt: Date;
    actualDurationMin?: number;
    notes?: string;
    actorType: 'INSTRUCTOR' | 'SYSTEM';
    reason: string;
  }) {
    const payoutPolicy = this.settings.get('payout');

    const service = await this.prisma.service.findUniqueOrThrow({
      where: { id: params.session.serviceId },
      select: { categoryId: true },
    });

    // The provider's band decides the commission unless a per-provider rule
    // overrides it (client, 17 Nov 2026 — state/pricing-rules.md).
    const provider = await this.prisma.instructorProfile.findUniqueOrThrow({
      where: { id: params.instructorId },
      select: { trainerCategoryId: true },
    });

    const rules = await this.prisma.commissionRule.findMany({
      where: { isActive: true, deletedAt: null },
    });

    const rule = resolveCommissionRule(
      rules.map(
        (r): CommissionRuleLike => ({
          id: r.id,
          scope: r.scope,
          categoryId: r.categoryId,
          serviceId: r.serviceId,
          trainerCategoryId: r.trainerCategoryId,
          instructorId: r.instructorId,
          type: r.type,
          value: Number(r.value),
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          isActive: r.isActive,
        }),
      ),
      {
        instructorId: params.instructorId,
        serviceId: params.session.serviceId,
        categoryId: service.categoryId,
        trainerCategoryId: provider.trainerCategoryId,
        on: params.completedAt,
      },
    );

    const earning = computeEarning(
      {
        sessionValue: Number(params.session.sessionValue),
        completedAt: params.completedAt,
      },
      rule,
      payoutPolicy,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.bookingSession.update({
        where: { id: params.session.id },
        data: {
          status: 'COMPLETED',
          completedAt: params.completedAt,
          ...(params.notes ? { notesByInstructor: params.notes } : {}),
        },
      });

      if (params.actualDurationMin !== undefined) {
        await tx.checkIn.updateMany({
          where: { sessionId: params.session.id },
          data: {
            checkOutAt: params.completedAt,
            actualDurationMin: params.actualDurationMin,
          },
        });
      }

      // upsert, not create: the auto-complete cron and a late check-out must
      // not be able to pay for the same session twice.
      const created = await tx.earning.upsert({
        where: { sessionId: params.session.id },
        create: {
          sessionId: params.session.id,
          instructorId: params.instructorId,
          sessionValue: earning.sessionValue,
          commissionAmount: earning.commissionAmount,
          deductions: earning.deductions,
          netAmount: earning.netAmount,
          status: 'PENDING',
          payableFrom: earning.payableFrom,
          commissionRuleId: earning.commissionRuleId,
        },
        update: {},
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: params.session.bookingId,
          sessionId: params.session.id,
          fromStatus: params.session.status as never,
          toStatus: 'COMPLETED',
          actorType: params.actorType,
          actorId: params.actorType === 'INSTRUCTOR' ? params.instructorId : null,
          reason: params.reason,
        },
      });

      this.logger.log(
        `Session ${params.session.id} completed: value ${earning.sessionValue}, commission ${earning.commissionAmount}, net ${earning.netAmount}`,
      );

      return {
        sessionId: params.session.id,
        completedAt: params.completedAt,
        earning: {
          id: created.id,
          sessionValue: earning.sessionValue,
          commissionAmount: earning.commissionAmount,
          netAmount: earning.netAmount,
          status: created.status,
          payableFrom: earning.payableFrom,
        },
      };
    });
  }

  /** Teacher logs what was covered, during or after the session. */
  async saveNotes(instructorId: string, sessionId: string, notes: string) {
    await this.requireOwnSession(instructorId, sessionId);

    return this.prisma.bookingSession.update({
      where: { id: sessionId },
      data: { notesByInstructor: notes },
      select: { id: true, notesByInstructor: true },
    });
  }

  /** Duty toggle — controls whether new offers arrive (spec 6.3). */
  async setDutyStatus(instructorId: string, onDuty: boolean) {
    return this.prisma.instructorProfile.update({
      where: { id: instructorId },
      data: { dutyStatus: onDuty ? 'ON_DUTY' : 'OFF_DUTY' },
      select: { id: true, dutyStatus: true },
    });
  }

  // -------------------------------------------------------------------------

  private async requireOwnSession(
    instructorId: string,
    sessionId: string,
    extraInclude?: Record<string, unknown>,
  ) {
    const session = await this.prisma.bookingSession.findFirst({
      where: { id: sessionId, instructorId, deletedAt: null },
      ...(extraInclude ? { include: extraInclude as never } : {}),
    });

    if (!session) {
      // Deliberately "not found", not "forbidden": a teacher must not be able
      // to discover that a session exists for someone else.
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
    }

    return session;
  }

  private async transition(
    session: { id: string; bookingId: string; status: string },
    to: 'EN_ROUTE',
    audit: { actorType: 'INSTRUCTOR'; actorId: string; reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bookingSession.update({
        where: { id: session.id },
        data: { status: to },
        select: { id: true, status: true },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: session.bookingId,
          sessionId: session.id,
          fromStatus: session.status as never,
          toStatus: to,
          actorType: audit.actorType,
          actorId: audit.actorId,
          reason: audit.reason,
        },
      });

      return updated;
    });
  }
}

/** @deprecated Use the helpers in common/dates/calendar instead. */
export { calendarDayOf as startOfDay } from '../../common/dates/calendar';
