import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export interface PageFilter {
  skip: number;
  take: number;
}

export interface CouponListFilter extends PageFilter {
  q?: string;
  /** undefined means "either" — the `all` filter. */
  isActive?: boolean;
  /** Validity window test, evaluated against this calendar day. */
  validity?: 'valid' | 'upcoming' | 'expired';
  today: Date;
}

/**
 * Prisma access for coupons. Queries only — every rule lives in
 * CouponService.
 *
 * Soft delete is the house style here as on the masters: a booking priced
 * against `DIWALI25` still points at that row, and a hard delete would take
 * the reason for its discount with it.
 */
@Injectable()
export class CouponRepository {
  constructor(private readonly prisma: PrismaService) {}

  private whereOf(filter: CouponListFilter): Prisma.CouponWhereInput {
    const { q, isActive, validity, today } = filter;

    return {
      deletedAt: null,
      ...(isActive === undefined ? {} : { isActive }),
      ...(q ? { code: { contains: q, mode: 'insensitive' as const } } : {}),
      // Both bounds are inclusive calendar days, so "valid today" is
      // validFrom <= today <= validTo.
      ...(validity === 'valid'
        ? { validFrom: { lte: today }, validTo: { gte: today } }
        : {}),
      ...(validity === 'upcoming' ? { validFrom: { gt: today } } : {}),
      ...(validity === 'expired' ? { validTo: { lt: today } } : {}),
    };
  }

  async list(filter: CouponListFilter) {
    const where = this.whereOf(filter);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.coupon.count({ where }),
    ]);

    return { rows, total };
  }

  find(id: string) {
    return this.prisma.coupon.findFirst({ where: { id, deletedAt: null } });
  }

  findByCode(code: string) {
    return this.prisma.coupon.findFirst({
      where: { code, deletedAt: null },
    });
  }

  create(data: Prisma.CouponCreateInput) {
    return this.prisma.coupon.create({ data });
  }

  update(id: string, data: Prisma.CouponUpdateInput) {
    return this.prisma.coupon.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.prisma.coupon.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * How many times this customer has already redeemed this coupon. Counts
   * bookings rather than a separate ledger: `Booking.couponId` is set in the
   * same transaction that increments `usedCount`, so the two cannot drift.
   *
   * Soft-deleted bookings are excluded — a cancelled booking gives the
   * redemption back (see CouponService.release).
   */
  countRedemptionsBy(couponId: string, customerId: string) {
    return this.prisma.booking.count({
      where: { couponId, customerId, deletedAt: null },
    });
  }
}
