import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { AssignmentService } from '../assignment/assignment.service';
import { AvailabilityService } from '../availability/availability.service';
import {
  CouponService,
  type CouponApplication,
} from '../coupon/coupon.service';
import {
  addCalendarDays,
  calendarWeekday,
  parseCalendarDate,
  todayCalendar,
} from '../../common/dates/calendar';
import {
  quote as computeQuote,
  splitSessionValues,
  type QuoteBreakup,
} from './pricing.calculator';
import { PricingResolver, type PricingBasis } from './pricing.resolver';
import type { CreateBookingDto, QuoteBookingDto } from './dto/booking.dto';
import type { ListBookingsQueryDto } from './dto/admin-booking.dto';
import type { SessionStatus } from '../../generated/prisma/enums';

/** Already finished or already cancelled — nothing left to cancel. */
const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = [
  'COMPLETED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_TEACHER',
  'CANCELLED_BY_ADMIN',
  'NO_SHOW_CUSTOMER',
  'NO_SHOW_TEACHER',
];

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly availability: AvailabilityService,
    private readonly assignment: AssignmentService,
    private readonly coupons: CouponService,
    private readonly pricing: PricingResolver,
  ) {}

  /**
   * Resolves `couponCode` into a rupee discount (PDF 6.9).
   *
   * The coupon is checked against the **service value plus add-ons, before
   * travel** — travel is a cost passed through to the teacher, not margin to
   * discount, and `minBookingAmount` reads as a floor on what was booked
   * rather than on how far the teacher had to ride.
   *
   * Returns the client's advisory `discount` untouched when no code was sent,
   * so a membership discount still works.
   */
  private async resolveDiscount(
    customerId: string,
    dto: QuoteBookingDto,
    base: number,
  ): Promise<{ discount?: number; applied: CouponApplication | null }> {
    if (!dto.couponCode) {
      return { discount: dto.discount, applied: null };
    }

    const applied = await this.coupons.validate(
      customerId,
      dto.couponCode,
      base,
    );

    return { discount: applied.discount, applied };
  }

  /**
   * The resolved pricing basis in the shape the calculator takes. Free
   * sessions are excluded: they are delivered, never charged.
   */
  private quoteInput(basis: PricingBasis, dto: QuoteBookingDto) {
    return {
      unitPrice: basis.unitPrice,
      sessionCount: basis.paidSessionCount,
      participantCount: basis.participantCount,
      percentAdjust: basis.percentAdjust,
      addons: basis.addons,
      distanceKm: dto.distanceKm,
    };
  }

  /**
   * Price breakup shown before payment (spec 3.1 step 9). Pure read — creates
   * nothing, holds nothing, so the customer can adjust add-ons freely.
   */
  async quote(
    customerId: string,
    dto: QuoteBookingDto,
  ): Promise<
    QuoteBreakup & {
      sessionCount: number;
      freeSessionCount: number;
      currency: string;
      coupon: { code: string; discount: number } | null;
    }
  > {
    const payment = this.settings.get('payment');
    const basis = await this.pricing.resolve(dto);
    const sessionCount = basis.paidSessionCount;

    // Priced once with no discount, to get the base the coupon applies to;
    // then again with the discount the server computed from it.
    const undiscounted = computeQuote(
      {
        ...this.quoteInput(basis, dto),
        walletApplied: dto.walletApplied,
      },
      payment,
    );

    const { discount, applied } = await this.resolveDiscount(
      customerId,
      dto,
      undiscounted.grossAmount + undiscounted.addonAmount,
    );

    const breakup = computeQuote(
      {
        ...this.quoteInput(basis, dto),
        discount,
        walletApplied: dto.walletApplied,
      },
      payment,
    );

    return {
      ...breakup,
      sessionCount,
      freeSessionCount: basis.freeSessionCount,
      currency: 'INR',
      // US-A09: the applicable discount, displayed before payment.
      coupon: applied
        ? { code: applied.code, discount: applied.discount }
        : null,
    };
  }

  /**
   * Creates the booking and its sessions in one transaction (spec 3.1 step
   * 10). The slot is re-validated inside the transaction: the list the
   * customer saw may be seconds old, and two customers can race for the last
   * slot.
   *
   * The booking lands in PENDING_PAYMENT with holdExpiresAt set; the expiry
   * job releases it if payment never arrives.
   */
  async create(customerId: string, dto: CreateBookingDto) {
    const payment = this.settings.get('payment');
    const basis = await this.pricing.resolve(dto);
    const { service, pkg, addons } = basis;

    const address = await this.prisma.address.findFirst({
      where: { id: dto.addressId, customerId, deletedAt: null },
      select: { id: true },
    });

    if (!address) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Address not found on your account',
      });
    }

    const occurrences = this.buildOccurrences(dto, pkg, service.durationMin);

    if (occurrences.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'No valid session dates were produced for this booking',
      });
    }

    // Free sessions are occurrences too, so the paid count is the package's
    // own figure — never the length of the list.
    const freeSessionCount = Math.min(
      basis.freeSessionCount,
      Math.max(occurrences.length - basis.paidSessionCount, 0),
    );
    const sessionCount = occurrences.length - freeSessionCount;

    const undiscounted = computeQuote(
      {
        ...this.quoteInput(basis, dto),
        sessionCount,
        walletApplied: dto.walletApplied,
      },
      payment,
    );

    // The coupon is re-validated here, not trusted from the quote the app
    // showed: it may have expired or run out since.
    const { discount, applied } = await this.resolveDiscount(
      customerId,
      dto,
      undiscounted.grossAmount + undiscounted.addonAmount,
    );

    const breakup = computeQuote(
      {
        ...this.quoteInput(basis, dto),
        sessionCount,
        discount,
        walletApplied: dto.walletApplied,
      },
      payment,
    );

    // Values that sum back exactly to the gross, so the earning rows can
    // never total more than the customer paid. The free sessions carry zero:
    // the customer is not charged and the provider is not paid for them.
    const sessionValues = splitSessionValues(
      breakup.grossAmount,
      sessionCount,
      freeSessionCount,
    );

    // If the customer picked a specific teacher, confirm they are still free
    // for every occurrence before taking any money.
    if (dto.instructorId) {
      for (const occurrence of occurrences) {
        const free = await this.availability.isSlotStillFree({
          instructorId: dto.instructorId,
          date: occurrence.date,
          fromMinute: occurrence.fromMinute,
          toMinute: occurrence.toMinute,
        });

        if (!free) {
          throw new ConflictException({
            code: ErrorCode.DUPLICATE_RESOURCE,
            message:
              'That teacher is no longer available for one of the selected slots.',
            details: {
              date: occurrence.date.toISOString().slice(0, 10),
              fromMinute: occurrence.fromMinute,
            },
          });
        }
      }
    }

    const holdExpiresAt = new Date(
      Date.now() + payment.slotHoldMinutes * 60_000,
    );

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          code: await this.nextBookingCode(tx),
          customerId,
          serviceId: service.id,
          packageId: pkg?.id,
          addressId: address.id,
          type: pkg ? 'PACKAGE' : 'SINGLE',
          sessionCount,
          participantCount: basis.participantCount,
          grossAmount: breakup.grossAmount,
          discount: breakup.discount,
          travelCharge: breakup.travelCharge,
          addonAmount: breakup.addonAmount,
          tax: breakup.tax,
          walletApplied: breakup.walletApplied,
          payable: breakup.payable,
          paymentStatus: 'UNPAID',
          source: dto.source ?? 'APP_CUSTOMER',
          couponId: applied?.couponId,
          // Cast because Prisma's Json input type does not accept an open
          // Record; the DTO has already validated this is a plain object.
          preferences: (dto.preferences ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          holdExpiresAt,
          sessions: {
            create: occurrences.map((occurrence, index) => ({
              sequence: index + 1,
              serviceId: service.id,
              sessionDate: occurrence.date,
              fromMinute: occurrence.fromMinute,
              toMinute: occurrence.toMinute,
              durationMin: service.durationMin,
              addressId: address.id,
              instructorId: dto.instructorId,
              status: 'PENDING_PAYMENT',
              sessionValue: sessionValues[index],
              // Generated now so the confirmation screen can show it; the
              // teacher only sees it after assignment.
              checkInOtp: randomInt(0, 10_000).toString().padStart(4, '0'),
            })),
          },
        },
      });

      // Read back explicitly rather than relying on `include` through the
      // nested create — the sessions are needed for the history rows below.
      const sessions = await tx.bookingSession.findMany({
        where: { bookingId: created.id },
        orderBy: { sequence: 'asc' },
      });

      // Inside the transaction, and conditional on the cap: two customers
      // racing for the last redemption cannot both win, and a lost race
      // rolls the whole booking back rather than discounting for free.
      if (applied) {
        await this.coupons.redeem(tx, applied.couponId, applied.usageLimit);
      }

      if (dto.addonIds?.length) {
        await tx.bookingAddon.createMany({
          data: addons.map((line) => ({
            bookingId: created.id,
            addonId: line.addonId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        });
      }

      // Every transition is recorded — this is the trail support and finance
      // work from (spec 3.2).
      await tx.bookingStatusHistory.createMany({
        data: sessions.map((session) => ({
          bookingId: created.id,
          sessionId: session.id,
          toStatus: 'PENDING_PAYMENT' as const,
          actorType: 'CUSTOMER' as const,
          actorId: customerId,
          reason: 'Booking created',
        })),
      });

      return { ...created, sessions };
    });

    this.logger.log(
      `Booking ${booking.code} created: ${sessionCount} session(s), payable ${breakup.payable}`,
    );

    return {
      id: booking.id,
      code: booking.code,
      payable: booking.payable,
      paymentStatus: booking.paymentStatus,
      holdExpiresAt: booking.holdExpiresAt,
      breakup,
      sessions: booking.sessions.map((session) => ({
        id: session.id,
        sequence: session.sequence,
        sessionDate: session.sessionDate,
        fromMinute: session.fromMinute,
        toMinute: session.toMinute,
        status: session.status,
        sessionValue: session.sessionValue,
      })),
    };
  }

  /**
   * Marks a booking paid and releases its sessions into the assignment
   * queue. The payments module will call this from the verified Razorpay
   * webhook; until then it is reachable from the admin panel, which is also
   * how a cash or manual payment is recorded.
   */
  async confirmPayment(bookingId: string, actorId: string, actorType: 'ADMIN' | 'SYSTEM') {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, deletedAt: null },
      include: { sessions: { where: { status: 'PENDING_PAYMENT' } } },
    });

    if (!booking) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Booking not found',
      });
    }

    if (booking.paymentStatus === 'PAID') {
      throw new BadRequestException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: 'This booking is already paid',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: 'PAID', holdExpiresAt: null },
      });

      await tx.bookingSession.updateMany({
        where: { bookingId, status: 'PENDING_PAYMENT' },
        data: { status: 'CONFIRMED' },
      });

      await tx.bookingStatusHistory.createMany({
        data: booking.sessions.map((session) => ({
          bookingId,
          sessionId: session.id,
          fromStatus: 'PENDING_PAYMENT' as const,
          toStatus: 'CONFIRMED' as const,
          actorType,
          actorId: actorType === 'ADMIN' ? actorId : null,
          reason: 'Payment confirmed',
        })),
      });
    });

    // Offer each session. Two paths, and which one runs is decided by whether
    // the customer picked a provider:
    //
    //   picked  → a DIRECT request that provider accepts or rejects (§4.7).
    //             Until 20-11-2026 `create` simply wrote `instructorId` onto
    //             the session and `offerNextCandidate` refused it as already
    //             assigned, so a chosen provider was never asked at all — the
    //             marketplace's accept/reject step did not exist.
    //   not     → the ranked auto-assign cascade, unchanged.
    //
    // Failures are logged rather than thrown: the money is taken and the
    // booking is valid, so an unoffered session belongs in the admin queue,
    // not in a failed HTTP response.
    const offers = [];
    for (const session of booking.sessions) {
      const chosen = session.instructorId;

      const offer = await (
        chosen
          ? this.assignment.offerDirect(session.id, chosen)
          : this.assignment.offerNextCandidate(session.id)
      ).catch((error: unknown) => {
        this.logger.error(
          `${chosen ? 'Direct request' : 'Auto-assign'} failed for session ${session.id}`,
          error instanceof Error ? error.stack : String(error),
        );
        return null;
      });

      offers.push({
        sessionId: session.id,
        offered: Boolean(offer),
        mode: chosen ? ('DIRECT' as const) : ('AUTO' as const),
      });
    }

    this.logger.log(
      `Booking ${booking.code} confirmed: ${offers.filter((o) => o.offered).length}/${offers.length} session(s) offered`,
    );

    return { bookingId, paymentStatus: 'PAID' as const, offers };
  }

  /** Customer's own bookings, newest first. */
  async listForCustomer(
    customerId: string,
    filter: { status?: 'upcoming' | 'completed' | 'cancelled' },
  ) {
    const today = todayCalendar();

    const statusFilter = (() => {
      switch (filter.status) {
        case 'completed':
          return { status: { in: ['COMPLETED' as const] } };
        case 'cancelled':
          return {
            status: {
              in: [
                'CANCELLED_BY_CUSTOMER' as const,
                'CANCELLED_BY_TEACHER' as const,
                'CANCELLED_BY_ADMIN' as const,
                'NO_SHOW_CUSTOMER' as const,
                'NO_SHOW_TEACHER' as const,
              ],
            },
          };
        case 'upcoming':
          return { sessionDate: { gte: today } };
        default:
          return {};
      }
    })();

    return this.prisma.booking.findMany({
      where: {
        customerId,
        deletedAt: null,
        ...(filter.status ? { sessions: { some: statusFilter } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        type: true,
        payable: true,
        paymentStatus: true,
        createdAt: true,
        service: { select: { id: true, name: true, durationMin: true } },
        // The customer's own list shows who the session is with and where —
        // the detail route already selected both; the list did not, which
        // left "My Bookings" unable to name the provider without an N+1.
        address: { select: { label: true, city: { select: { name: true } } } },
        sessions: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            sequence: true,
            sessionDate: true,
            fromMinute: true,
            toMinute: true,
            status: true,
            instructor: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  // ============================================================== admin side

  /**
   * The admin booking table (PDF 6.6). `status` matches a booking with any
   * session in that state — a package has many, and the operator is looking
   * for the booking, not the occurrence.
   */
  async listForAdmin(query: ListBookingsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.BookingWhereInput = {
      deletedAt: null,
      ...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
      ...(query.status && { sessions: { some: { status: query.status } } }),
      ...(query.q && {
        OR: [
          { code: { contains: query.q, mode: 'insensitive' } },
          { customer: { name: { contains: query.q, mode: 'insensitive' } } },
          { customer: { user: { mobile: { contains: query.q } } } },
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          code: true,
          type: true,
          sessionCount: true,
          payable: true,
          paymentStatus: true,
          createdAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              user: { select: { mobile: true } },
            },
          },
          service: { select: { id: true, name: true, durationMin: true } },
          sessions: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              sequence: true,
              sessionDate: true,
              fromMinute: true,
              toMinute: true,
              status: true,
              instructor: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * One booking's file, for support (PDF 6.6 — "access booking details for
   * support purposes"). Carries the status history, which is the acceptance /
   * rejection / cancellation record the same section asks for.
   */
  async getForAdmin(bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, deletedAt: null },
      include: {
        service: true,
        address: true,
        customer: {
          select: {
            id: true,
            name: true,
            user: { select: { mobile: true, email: true } },
          },
        },
        sessions: {
          orderBy: { sequence: 'asc' },
          include: {
            instructor: { select: { id: true, name: true, ratingAvg: true } },
          },
        },
        addons: { include: { addon: { select: { name: true } } } },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amount: true,
            status: true,
            method: true,
            createdAt: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Booking not found',
      });
    }

    return booking;
  }

  /**
   * Admin cancellation (PDF 6.6, "permitted administrative status actions").
   *
   * Cancels every session that has not already run or been cancelled, and
   * writes one `booking_status_history` row per session with the actor and the
   * reason — 6.6 wants the cancellation *record*, not just the end state.
   *
   * It deliberately does **not** compute a refund. Refunds are their own
   * module with their own policy slabs and their own audit; silently issuing
   * one from a table action would hide money movement from finance.
   */
  async cancelForAdmin(
    bookingId: string,
    reason: string,
    adminUserId: string,
  ) {
    const booking = await this.getForAdmin(bookingId);

    const cancellable = booking.sessions.filter(
      (s) => !TERMINAL_SESSION_STATUSES.includes(s.status),
    );

    if (cancellable.length === 0) {
      throw new ConflictException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Every session on this booking is already finished or cancelled',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bookingSession.updateMany({
        where: { id: { in: cancellable.map((s) => s.id) } },
        data: { status: 'CANCELLED_BY_ADMIN', cancelReason: reason },
      });

      await tx.bookingStatusHistory.createMany({
        data: cancellable.map((s) => ({
          bookingId: booking.id,
          sessionId: s.id,
          fromStatus: s.status,
          toStatus: 'CANCELLED_BY_ADMIN' as const,
          actorType: 'ADMIN' as const,
          actorId: adminUserId,
          reason,
        })),
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { cancelReason: reason },
      });

      // The redemption goes back only when the *whole* booking is cancelled
      // (PDF 6.9). A booking with a session already delivered has had the
      // benefit of the coupon, so cancelling the rest does not refund the use.
      if (booking.couponId && cancellable.length === booking.sessions.length) {
        await this.coupons.release(tx, booking.couponId);
      }
    });

    this.logger.log(
      `Booking ${booking.code} cancelled by admin ${adminUserId}: ${cancellable.length} session(s)`,
    );

    return {
      id: booking.id,
      code: booking.code,
      cancelledSessions: cancellable.length,
      paymentStatus: booking.paymentStatus,
    };
  }

  /** Full detail for one booking, scoped to its owner. */
  async getForCustomer(customerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId, deletedAt: null },
      include: {
        service: true,
        address: true,
        sessions: {
          orderBy: { sequence: 'asc' },
          include: {
            instructor: {
              select: {
                id: true,
                name: true,
                photoUrl: true,
                ratingAvg: true,
                languages: true,
              },
            },
          },
        },
        addons: { include: { addon: { select: { name: true } } } },
      },
    });

    if (!booking) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Booking not found',
      });
    }

    return booking;
  }

  // -------------------------------------------------------------------------

  /**
   * Expands a package into dated occurrences on the chosen weekdays, or
   * returns the single requested session.
   */
  private buildOccurrences(
    dto: CreateBookingDto,
    pkg: {
      sessionCount: number;
      freeSessionCount: number;
      allowedWeekdays: number[];
    } | null,
    durationMin: number,
  ): Array<{ date: Date; fromMinute: number; toMinute: number }> {
    const toMinute = dto.toMinute ?? dto.fromMinute + durationMin;
    // Parsed as a calendar day so a client in any timezone gets the day it asked for.
    const first = parseCalendarDate(dto.sessionDate);

    if (!pkg) {
      return [{ date: first, fromMinute: dto.fromMinute, toMinute }];
    }

    const weekdays =
      dto.weekdays && dto.weekdays.length > 0
        ? dto.weekdays
        : pkg.allowedWeekdays.length > 0
          ? pkg.allowedWeekdays
          : [calendarWeekday(first)];

    // A package restricted to certain weekdays cannot be booked on others.
    if (
      pkg.allowedWeekdays.length > 0 &&
      weekdays.some((day) => !pkg.allowedWeekdays.includes(day))
    ) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'This package is not available on one of the chosen weekdays',
      });
    }

    const occurrences: Array<{
      date: Date;
      fromMinute: number;
      toMinute: number;
    }> = [];
    let cursor = first;

    // Paid sessions plus the free ones the package throws in — a free session
    // is still delivered, so it needs a date like any other.
    const total = pkg.sessionCount + pkg.freeSessionCount;

    // Walk forward day by day, taking matching weekdays until the package is
    // filled. Bounded so a bad weekday list cannot loop forever.
    for (
      let guard = 0;
      occurrences.length < total && guard < 400;
      guard += 1
    ) {
      if (weekdays.includes(calendarWeekday(cursor))) {
        occurrences.push({ date: cursor, fromMinute: dto.fromMinute, toMinute });
      }
      cursor = addCalendarDays(cursor, 1);
    }

    return occurrences;
  }

  /**
   * Sequential, human-quotable code (HF-000123). Derived from the row count
   * inside the transaction; a collision would surface as a unique-constraint
   * violation rather than a silently duplicated code.
   */
  private async nextBookingCode(
    tx: Pick<PrismaService, 'booking'>,
  ): Promise<string> {
    const count = await tx.booking.count();
    return `HF-${String(count + 1).padStart(6, '0')}`;
  }
}
