import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CouponRepository } from './coupon.repository';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  formatCalendarDate,
  parseCalendarDate,
  todayCalendar,
} from '../../common/dates/calendar';
import type { Prisma } from '../../generated/prisma/client';
import {
  CouponStatusFilter,
  CouponValidityFilter,
  type CreateCouponDto,
  type ListCouponsQueryDto,
  type UpdateCouponDto,
} from './dto/coupon.dto';

export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

/** What the customer is shown before payment (US-A09). */
export interface CouponApplication {
  couponId: string;
  code: string;
  discountType: 'PERCENT' | 'FLAT';
  /** The rupee discount to apply to `amount`, already capped. */
  discount: number;
  /** `amount - discount`, for the "you pay" line. */
  payable: number;
  /**
   * Carried through so the booking transaction can re-check the cap at
   * redemption time without a second read. Null means unlimited.
   */
  usageLimit: number | null;
}

/**
 * Coupons and promotional settings (PDF 6.9, US-A09).
 *
 * Three rules hold here:
 *
 * 1. **The server computes the discount, never the client.** `validate` and
 *    the booking transaction run the same `discountFor`, so the figure shown
 *    before payment is the figure charged. The old advisory `discount` on the
 *    booking DTO is what this replaces.
 * 2. **Validity is a calendar-day question.** `validFrom`/`validTo` are `date`
 *    columns and both ends are inclusive, so everything goes through
 *    `common/dates/calendar` — comparing a `date` against `new Date()` is the
 *    off-by-one-day bug this project has already paid for once.
 * 3. **A redeemed coupon's code is frozen.** Everything else stays editable,
 *    but the code is what a past booking was priced against; renaming it
 *    rewrites history.
 *
 * Soft delete throughout, and every mutation writes an audit row.
 */
@Injectable()
export class CouponService {
  constructor(
    private readonly repo: CouponRepository,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private pageOf(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return { page, limit, skip: (page - 1) * limit, take: limit };
  }

  private metaOf(page: number, limit: number, total: number) {
    return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  private invalid(message: string): never {
    throw new BadRequestException({
      code: ErrorCode.COUPON_INVALID,
      message,
    });
  }

  /** Rounded to paise so a percentage can never produce a fraction of one. */
  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * The discount this coupon gives on `amount`, capped twice: by
   * `maxDiscount` on a percentage coupon, and by the charge itself — a flat
   * ₹500 off a ₹300 booking is ₹300 off, never a negative payable.
   */
  private discountFor(
    coupon: {
      discountType: string;
      discountValue: Prisma.Decimal;
      maxDiscount: Prisma.Decimal | null;
    },
    amount: number,
  ): number {
    const value = Number(coupon.discountValue);

    let discount =
      coupon.discountType === 'PERCENT' ? (amount * value) / 100 : value;

    if (coupon.discountType === 'PERCENT' && coupon.maxDiscount !== null) {
      discount = Math.min(discount, Number(coupon.maxDiscount));
    }

    return this.round2(Math.min(discount, amount));
  }

  /** The row as the API returns it — Decimals as numbers, dates as days. */
  private present(coupon: {
    id: string;
    code: string;
    description: string | null;
    discountType: string;
    discountValue: Prisma.Decimal;
    maxDiscount: Prisma.Decimal | null;
    minBookingAmount: Prisma.Decimal;
    validFrom: Date;
    validTo: Date;
    usageLimit: number | null;
    perCustomerLimit: number | null;
    usedCount: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const today = todayCalendar();

    return {
      id: coupon.id,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
      maxDiscount:
        coupon.maxDiscount === null ? null : Number(coupon.maxDiscount),
      minBookingAmount: Number(coupon.minBookingAmount),
      validFrom: formatCalendarDate(coupon.validFrom),
      validTo: formatCalendarDate(coupon.validTo),
      usageLimit: coupon.usageLimit,
      perCustomerLimit: coupon.perCustomerLimit,
      usedCount: coupon.usedCount,
      isActive: coupon.isActive,
      /** Derived, so the table can show why an active coupon still does nothing. */
      validity:
        coupon.validFrom > today
          ? 'upcoming'
          : coupon.validTo < today
            ? 'expired'
            : 'valid',
      exhausted:
        coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit,
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
    };
  }

  /**
   * Shared field checks for create and update. Run against the merged result
   * so an update that moves only `validFrom` is still checked against the
   * stored `validTo`.
   */
  private assertConsistent(merged: {
    discountType: string;
    discountValue: number;
    maxDiscount?: number | null;
    validFrom: Date;
    validTo: Date;
  }) {
    if (merged.discountType === 'PERCENT' && merged.discountValue > 100) {
      this.invalid('A percentage discount cannot exceed 100');
    }

    // A ceiling on a flat discount is meaningless and would read as a second,
    // contradictory amount in the admin table.
    if (
      merged.discountType === 'FLAT' &&
      merged.maxDiscount !== null &&
      merged.maxDiscount !== undefined
    ) {
      this.invalid('maxDiscount applies only to a percentage discount');
    }

    if (merged.validTo < merged.validFrom) {
      this.invalid('validTo cannot be earlier than validFrom');
    }
  }

  // ------------------------------------------------------------------ admin

  async list(query: ListCouponsQueryDto) {
    const { page, limit, skip, take } = this.pageOf(query);

    const status = query.status ?? CouponStatusFilter.ALL;
    const validity = query.validity ?? CouponValidityFilter.ALL;

    const { rows, total } = await this.repo.list({
      skip,
      take,
      q: query.q,
      isActive:
        status === CouponStatusFilter.ALL
          ? undefined
          : status === CouponStatusFilter.ACTIVE,
      validity:
        validity === CouponValidityFilter.ALL ? undefined : validity,
      today: todayCalendar(),
    });

    return {
      rows: rows.map((row) => this.present(row)),
      meta: this.metaOf(page, limit, total),
    };
  }

  async create(dto: CreateCouponDto, actor: AdminActor) {
    const code = dto.code.trim().toUpperCase();

    if (await this.repo.findByCode(code)) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: `Coupon ${code} already exists`,
      });
    }

    const validFrom = parseCalendarDate(dto.validFrom);
    const validTo = parseCalendarDate(dto.validTo);

    this.assertConsistent({
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      maxDiscount: dto.maxDiscount ?? null,
      validFrom,
      validTo,
    });

    const created = await this.repo.create({
      code,
      description: dto.description,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      maxDiscount: dto.maxDiscount,
      minBookingAmount: dto.minBookingAmount ?? 0,
      validFrom,
      validTo,
      usageLimit: dto.usageLimit,
      perCustomerLimit: dto.perCustomerLimit,
      isActive: dto.isActive ?? true,
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'coupon.created',
      entityType: 'Coupon',
      entityId: created.id,
      after: created,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return this.present(created);
  }

  async update(id: string, dto: UpdateCouponDto, actor: AdminActor) {
    const before = await this.repo.find(id);

    if (!before) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Coupon not found',
      });
    }

    const data: Prisma.CouponUpdateInput = {};

    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();

      if (code !== before.code) {
        // Rule 3: the code a booking was priced against is frozen.
        if (before.usedCount > 0) {
          throw new ConflictException({
            code: ErrorCode.COUPON_ALREADY_REDEEMED,
            message:
              'This coupon has been redeemed, so its code can no longer be changed. Deactivate it and create a new one.',
          });
        }

        const clash = await this.repo.findByCode(code);

        if (clash) {
          throw new ConflictException({
            code: ErrorCode.DUPLICATE_RESOURCE,
            message: `Coupon ${code} already exists`,
          });
        }

        data.code = code;
      }
    }

    if (dto.description !== undefined) data.description = dto.description;
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.discountValue !== undefined) data.discountValue = dto.discountValue;
    if (dto.maxDiscount !== undefined) data.maxDiscount = dto.maxDiscount;
    if (dto.minBookingAmount !== undefined) {
      data.minBookingAmount = dto.minBookingAmount;
    }
    if (dto.usageLimit !== undefined) data.usageLimit = dto.usageLimit;
    if (dto.perCustomerLimit !== undefined) {
      data.perCustomerLimit = dto.perCustomerLimit;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const validFrom =
      dto.validFrom === undefined
        ? before.validFrom
        : parseCalendarDate(dto.validFrom);
    const validTo =
      dto.validTo === undefined
        ? before.validTo
        : parseCalendarDate(dto.validTo);

    if (dto.validFrom !== undefined) data.validFrom = validFrom;
    if (dto.validTo !== undefined) data.validTo = validTo;

    this.assertConsistent({
      discountType: dto.discountType ?? before.discountType,
      discountValue: dto.discountValue ?? Number(before.discountValue),
      maxDiscount:
        dto.maxDiscount !== undefined
          ? dto.maxDiscount
          : before.maxDiscount === null
            ? null
            : Number(before.maxDiscount),
      validFrom,
      validTo,
    });

    const after = await this.repo.update(id, data);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'coupon.updated',
      entityType: 'Coupon',
      entityId: id,
      before,
      after,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return this.present(after);
  }

  /**
   * PDF 6.9's "activate or deactivate". Its own route rather than a flag on
   * the edit form: it is the one coupon action ops takes in a hurry, and it
   * needs its own audit line.
   */
  async setStatus(id: string, isActive: boolean, actor: AdminActor) {
    const before = await this.repo.find(id);

    if (!before) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Coupon not found',
      });
    }

    const after = await this.repo.update(id, { isActive });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: isActive ? 'coupon.activated' : 'coupon.deactivated',
      entityType: 'Coupon',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return this.present(after);
  }

  async remove(id: string, actor: AdminActor) {
    const before = await this.repo.find(id);

    if (!before) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Coupon not found',
      });
    }

    const after = await this.repo.softDelete(id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'coupon.deleted',
      entityType: 'Coupon',
      entityId: id,
      before,
      after,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deletedAt: after.deletedAt };
  }

  // --------------------------------------------------------------- customer

  /**
   * US-A09: the applicable discount, shown before payment. Pure read —
   * nothing is reserved, so the customer can type a code, see the figure and
   * walk away.
   *
   * Every refusal carries its own error code so the app can say *why* rather
   * than a flat "invalid coupon".
   */
  async validate(
    customerId: string,
    code: string,
    amount: number,
  ): Promise<CouponApplication> {
    const coupon = await this.repo.findByCode(code.trim().toUpperCase());

    if (!coupon || !coupon.isActive) {
      this.invalid('This coupon code is not valid');
    }

    const today = todayCalendar();

    if (coupon.validFrom > today) {
      this.invalid(
        `This coupon is valid from ${formatCalendarDate(coupon.validFrom)}`,
      );
    }

    if (coupon.validTo < today) {
      this.invalid('This coupon has expired');
    }

    if (amount < Number(coupon.minBookingAmount)) {
      throw new BadRequestException({
        code: ErrorCode.COUPON_MIN_NOT_MET,
        message: `This coupon needs a booking of at least ₹${Number(coupon.minBookingAmount)}`,
        details: { minBookingAmount: Number(coupon.minBookingAmount) },
      });
    }

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new ConflictException({
        code: ErrorCode.COUPON_LIMIT_REACHED,
        message: 'This coupon has been fully redeemed',
      });
    }

    if (coupon.perCustomerLimit !== null) {
      const mine = await this.repo.countRedemptionsBy(coupon.id, customerId);

      if (mine >= coupon.perCustomerLimit) {
        throw new ConflictException({
          code: ErrorCode.COUPON_LIMIT_REACHED,
          message: 'You have already used this coupon',
        });
      }
    }

    const discount = this.discountFor(coupon, amount);

    return {
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType as 'PERCENT' | 'FLAT',
      discount,
      payable: this.round2(amount - discount),
      usageLimit: coupon.usageLimit,
    };
  }

  /**
   * Called from inside the booking transaction, after `validate` has passed.
   *
   * The increment is conditional — `usedCount` must still be under the limit
   * when the update runs — so two customers racing for the last redemption
   * cannot both get it. A zero-row update means the other one won, and the
   * transaction is rolled back.
   */
  async redeem(
    tx: Prisma.TransactionClient,
    couponId: string,
    usageLimit: number | null,
  ): Promise<void> {
    const { count } = await tx.coupon.updateMany({
      where: {
        id: couponId,
        deletedAt: null,
        isActive: true,
        ...(usageLimit === null ? {} : { usedCount: { lt: usageLimit } }),
      },
      data: { usedCount: { increment: 1 } },
    });

    if (count === 0) {
      throw new ConflictException({
        code: ErrorCode.COUPON_LIMIT_REACHED,
        message: 'This coupon was fully redeemed while you were booking',
      });
    }
  }

  /**
   * Gives a redemption back when a booking that carried a coupon is
   * cancelled. Floors at zero rather than trusting the counter: a release
   * that runs twice must not push the count negative and hand out a free
   * redemption.
   */
  async release(
    tx: Prisma.TransactionClient,
    couponId: string,
  ): Promise<void> {
    await tx.coupon.updateMany({
      where: { id: couponId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }
}
