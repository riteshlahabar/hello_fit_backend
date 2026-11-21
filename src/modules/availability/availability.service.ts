import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  calendarDayOf,
  calendarDaysBetween,
  calendarWeekday,
  todayCalendar,
} from '../../common/dates/calendar';
import {
  computeSlots,
  formatMinute,
  mergeBands,
  type Slot,
  type TimeBand,
} from './slot.calculator';
import { openBandsFor } from './default-window';

/** Statuses that still occupy a teacher's time. */
const OCCUPYING_STATUSES = [
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'RESCHEDULE_REQUESTED',
  'PENDING_PAYMENT',
] as const;

export interface SlotOption {
  fromMinute: number;
  toMinute: number;
  fromTime: string;
  toTime: string;
  /** Teachers who can take this slot, best-effort count for the UI. */
  availableInstructors: number;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The slot grid the customer sees (spec 3.1 step 4). Computed as the union
   * of every eligible teacher's free slots, so a slot is offered when at
   * least one teacher could take it — the specific teacher is chosen later by
   * the matching engine.
   */
  async findSlots(params: {
    serviceId: string;
    date: Date;
    addressId: string;
    /** Optional: restrict to one teacher, for "book this teacher" flows. */
    instructorId?: string;
  }): Promise<SlotOption[]> {
    const scheduling = this.settings.get('scheduling');

    const service = await this.prisma.service.findFirst({
      where: { id: params.serviceId, isActive: true, deletedAt: null },
      select: { id: true, durationMin: true },
    });

    if (!service) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
      });
    }

    const address = await this.prisma.address.findFirst({
      where: { id: params.addressId, deletedAt: null },
      select: { id: true, areaId: true, cityId: true },
    });

    if (!address) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Address not found',
      });
    }

    if (!address.areaId) {
      // The address sits outside every serviceable area — this is what drives
      // the app's "coming soon, notify me" state (spec 3.1).
      return [];
    }

    this.assertBookableDate(params.date, scheduling.maxAdvanceDays);

    // Calendar day, not an instant: the date column stores UTC midnight,
    // so the weekday must be read in the same terms.
    const dayStart = calendarDayOf(params.date);
    const weekday = calendarWeekday(dayStart);

    // A holiday that blocks booking closes the whole day for that city.
    const holiday = await this.prisma.holiday.findFirst({
      where: {
        date: dayStart,
        blocksBooking: true,
        OR: [{ cityId: null }, { cityId: address.cityId }],
      },
      select: { id: true },
    });

    if (holiday) return [];

    // Teachers who serve this area and offer this service, with everything
    // the slot computation needs in one round trip.
    const candidates = await this.prisma.instructorProfile.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        kycStatus: 'VERIFIED',
        ...(params.instructorId ? { id: params.instructorId } : {}),
        instructorServices: {
          some: { serviceId: service.id, isActive: true, deletedAt: null },
        },
        instructorServiceAreas: { some: { areaId: address.areaId } },
      },
      select: {
        id: true,
        travelBufferMin: true,
        dailySessionCap: true,
        availabilityRules: {
          where: {
            isActive: true,
            deletedAt: null,
            weekday,
            effectiveFrom: { lte: dayStart },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: dayStart } }],
          },
          select: { startMinute: true, endMinute: true },
        },
        availabilityOverrides: {
          where: { date: dayStart },
          select: { startMinute: true, endMinute: true, isBlocked: true },
        },
        leaves: {
          where: {
            status: 'APPROVED',
            fromDate: { lte: dayStart },
            toDate: { gte: dayStart },
          },
          select: { id: true },
        },
        bookingSessions: {
          where: {
            sessionDate: dayStart,
            status: { in: [...OCCUPYING_STATUSES] },
            deletedAt: null,
          },
          select: { fromMinute: true, toMinute: true },
        },
      },
    });

    // Count how many teachers can serve each slot, so the UI can show
    // scarcity and the booking transaction has a cheap pre-check.
    const tally = new Map<string, { slot: Slot; count: number }>();

    for (const candidate of candidates) {
      const extraBands = candidate.availabilityOverrides
        .filter((o) => !o.isBlocked && o.startMinute !== null)
        .map((o) => ({
          startMinute: o.startMinute as number,
          endMinute: o.endMinute as number,
        }));

      const slots = computeSlots(
        {
          date: params.date,
          now: new Date(),
          serviceDurationMin: service.durationMin,
          // No rule for this weekday means open across the institute window,
          // not closed — see `openBandsFor`.
          availability: openBandsFor(
            candidate.availabilityRules,
            extraBands,
            scheduling,
          ),
          extraBands,
          blockedBands: this.blockedBandsFrom(candidate.availabilityOverrides),
          // BookingSession stores from/to; BusyBand speaks start/end.
          busy: candidate.bookingSessions.map((session) => ({
            startMinute: session.fromMinute,
            endMinute: session.toMinute,
          })),
          travelBufferMin:
            candidate.travelBufferMin ?? scheduling.defaultTravelBufferMin,
          sessionsToday: candidate.bookingSessions.length,
          dailySessionCap: candidate.dailySessionCap,
          isBlockedDay: candidate.leaves.length > 0,
        },
        scheduling,
      );

      for (const slot of slots) {
        const key = `${slot.fromMinute}-${slot.toMinute}`;
        const existing = tally.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          tally.set(key, { slot, count: 1 });
        }
      }
    }

    return [...tally.values()]
      .sort((a, b) => a.slot.fromMinute - b.slot.fromMinute)
      .map(({ slot, count }) => ({
        fromMinute: slot.fromMinute,
        toMinute: slot.toMinute,
        fromTime: formatMinute(slot.fromMinute),
        toTime: formatMinute(slot.toMinute),
        availableInstructors: count,
      }));
  }

  /**
   * Re-checks one teacher against one slot. Called inside the booking
   * transaction, because the slot list the customer saw may be seconds stale.
   */
  async isSlotStillFree(params: {
    instructorId: string;
    date: Date;
    fromMinute: number;
    toMinute: number;
    /** Exclude a session being rescheduled from its own clash check. */
    excludeSessionId?: string;
  }): Promise<boolean> {
    const scheduling = this.settings.get('scheduling');
    const dayStart = calendarDayOf(params.date);

    const instructor = await this.prisma.instructorProfile.findFirst({
      where: { id: params.instructorId, deletedAt: null, status: 'ACTIVE' },
      select: { travelBufferMin: true, dailySessionCap: true },
    });

    if (!instructor) return false;

    const buffer =
      instructor.travelBufferMin ?? scheduling.defaultTravelBufferMin;

    // One query: any session whose buffered window overlaps the requested
    // window means the teacher is unavailable.
    const clashing = await this.prisma.bookingSession.count({
      where: {
        instructorId: params.instructorId,
        sessionDate: dayStart,
        deletedAt: null,
        status: { in: [...OCCUPYING_STATUSES] },
        ...(params.excludeSessionId ? { id: { not: params.excludeSessionId } } : {}),
        fromMinute: { lt: params.toMinute + buffer },
        toMinute: { gt: params.fromMinute - buffer },
      },
    });

    if (clashing > 0) return false;

    const onLeave = await this.prisma.leave.count({
      where: {
        instructorId: params.instructorId,
        status: 'APPROVED',
        fromDate: { lte: dayStart },
        toDate: { gte: dayStart },
      },
    });

    if (onLeave > 0) return false;

    const sessionsToday = await this.prisma.bookingSession.count({
      where: {
        instructorId: params.instructorId,
        sessionDate: dayStart,
        deletedAt: null,
        status: { in: [...OCCUPYING_STATUSES, 'COMPLETED'] },
      },
    });

    return sessionsToday < instructor.dailySessionCap;
  }

  private blockedBandsFrom(
    overrides: Array<{
      startMinute: number | null;
      endMinute: number | null;
      isBlocked: boolean;
    }>,
  ): TimeBand[] {
    const blocked = overrides
      .filter((o) => o.isBlocked)
      .map((o) => ({
        // A block with no times blocks the entire day.
        startMinute: o.startMinute ?? 0,
        endMinute: o.endMinute ?? 24 * 60,
      }));

    return mergeBands(blocked);
  }

  private assertBookableDate(date: Date, maxAdvanceDays: number): void {
    const daysAhead = calendarDaysBetween(todayCalendar(), date);

    if (daysAhead < 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'That date has already passed',
      });
    }

    if (daysAhead > maxAdvanceDays) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Bookings open ${maxAdvanceDays} days in advance`,
      });
    }
  }
}

/** @deprecated Use the helpers in common/dates/calendar instead. */
export { calendarDayOf as startOfDay } from '../../common/dates/calendar';
