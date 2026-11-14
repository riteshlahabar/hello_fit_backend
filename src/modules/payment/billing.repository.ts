import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** The booking fields the Billing row needs, and no more. */
const BOOKING_FOR_INVOICE = {
  select: {
    id: true,
    code: true,
    type: true,
    sessionCount: true,
    service: { select: { name: true } },
  },
} as const;

const BOOKING_FOR_REFUND = {
  select: {
    id: true,
    code: true,
    service: { select: { name: true } },
  },
} as const;

@Injectable()
export class BillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * This customer's invoices, newest first.
   *
   * **The `customerId` is in the `where`, not checked afterwards.** An invoice
   * belongs to a booking, so the only safe filter is through the relation; a
   * query that fetched by id and compared later is one forgotten comparison
   * away from serving another customer their neighbour's GST.
   */
  findInvoices(customerId: string, skip: number, take: number) {
    return this.prisma.invoice.findMany({
      where: { booking: { customerId, deletedAt: null } },
      include: { booking: BOOKING_FOR_INVOICE },
      orderBy: { issuedAt: 'desc' },
      skip,
      take,
    });
  }

  countInvoices(customerId: string) {
    return this.prisma.invoice.count({
      where: { booking: { customerId, deletedAt: null } },
    });
  }

  /** This customer's refunds, newest request first. */
  findRefunds(customerId: string, skip: number, take: number) {
    return this.prisma.refund.findMany({
      where: { booking: { customerId, deletedAt: null } },
      include: { booking: BOOKING_FOR_REFUND },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  countRefunds(customerId: string) {
    return this.prisma.refund.count({
      where: { booking: { customerId, deletedAt: null } },
    });
  }

  customerByUserId(userId: string) {
    return this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
  }
}
