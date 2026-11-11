import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/prisma/client';
import type { ListPaymentsQueryDto } from './dto/admin-payment.dto';

/**
 * One search box over four things an operator might be holding: the booking
 * code, the customer (name or mobile), the provider's name, and either gateway
 * reference. Defined once so the table and its summary cannot drift apart on
 * what "matching" means.
 */
function searchClause(q: string): Prisma.PaymentWhereInput {
  const insensitive = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { gatewayPaymentId: insensitive },
      { gatewayOrderId: insensitive },
      { booking: { code: insensitive } },
      { booking: { customer: { name: insensitive } } },
      { booking: { customer: { user: { mobile: { contains: q } } } } },
      { booking: { sessions: { some: { instructor: { name: insensitive } } } } },
    ],
  };
}

/**
 * Payment and transaction management (PDF 6.7).
 *
 * **Read-only, deliberately.** 6.7 lists seven functionalities and every one
 * of them is a view: transaction records, payment status, gateway references,
 * the booking each belongs to, failures, refund status, summaries. It then
 * says refund initiation "will depend on the selected payment gateway and the
 * agreed refund workflow" — so there is no refund action here, and no capture,
 * retry or adjustment either.
 *
 * **`rawPayload` never leaves the server.** It is the verbatim gateway
 * response, kept for reconciliation and disputes, and it can carry card and
 * payer detail. 6.7's own acceptance criteria require that sensitive payment
 * credentials are not exposed through the admin interface, so no select in
 * this file names that column.
 */
@Injectable()
export class AdminPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPaymentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PaymentWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.hasGatewayRef !== undefined &&
        (query.hasGatewayRef
          ? { gatewayPaymentId: { not: null } }
          : { gatewayPaymentId: null })),
      ...(query.q && searchClause(query.q)),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          gateway: true,
          gatewayOrderId: true,
          gatewayPaymentId: true,
          failureReason: true,
          paidAt: true,
          createdAt: true,
          booking: {
            select: {
              id: true,
              code: true,
              paymentStatus: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  user: { select: { mobile: true } },
                },
              },
              // The provider, from the session rather than the booking: the
              // customer may request one at booking time
              // (`CreateBookingDto.instructorId`) or leave it to assignment,
              // and either way it is the session that carries the answer.
              sessions: {
                orderBy: { sequence: 'asc' },
                take: 1,
                select: {
                  instructor: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * One transaction's file: the payment, the booking's invoice and any
   * refunds raised against that booking (PDF 6.7 — "view refund-related
   * status where supported").
   */
  async detail(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        amount: true,
        method: true,
        status: true,
        gateway: true,
        gatewayOrderId: true,
        gatewayPaymentId: true,
        failureReason: true,
        paidAt: true,
        createdAt: true,
        bookingId: true,
        booking: {
          select: {
            id: true,
            code: true,
            payable: true,
            paymentStatus: true,
            customer: {
              select: {
                id: true,
                name: true,
                user: { select: { mobile: true, email: true } },
              },
            },
            service: { select: { name: true } },
            sessions: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true,
                sequence: true,
                sessionDate: true,
                status: true,
                instructor: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Transaction not found',
      });
    }

    const [invoice, refunds] = await Promise.all([
      this.prisma.invoice.findFirst({
        where: { bookingId: payment.bookingId },
        select: {
          id: true,
          invoiceNo: true,
          taxableValue: true,
          taxBreakup: true,
          total: true,
          issuedAt: true,
        },
      }),
      this.prisma.refund.findMany({
        where: { bookingId: payment.bookingId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          mode: true,
          status: true,
          slabApplied: true,
          gatewayRefundId: true,
          processedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return { ...payment, invoice, refunds };
  }

  /**
   * The "relevant payment summaries" of 6.7: a count and a total per state,
   * over the same filter the table is showing.
   *
   * Grouped in the database rather than summed over the current page — a
   * summary that only describes 20 rows is worse than none.
   */
  async summary(query: ListPaymentsQueryDto) {
    const where: Prisma.PaymentWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.q && searchClause(query.q)),
    };

    const grouped = await this.prisma.payment.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    });

    return grouped.map((g) => ({
      status: g.status,
      count: g._count._all,
      amount: g._sum.amount ?? 0,
    }));
  }
}
