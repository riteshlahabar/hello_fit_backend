import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { EarningStatus, PayoutStatus } from '../../generated/prisma/enums';

/**
 * Prisma queries for earnings and payouts. No rules here.
 *
 * The one thing worth reading carefully is `createBatch`: a payout and the
 * earnings it contains must change together or not at all, and an earning must
 * never end up in two batches. Both are enforced inside the transaction rather
 * than hoped for.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- earnings

  /**
   * Earnings eligible for a cycle: payable, not withheld, not already in a
   * batch, and belonging to a session inside the cycle dates.
   *
   * `payoutItem: null` is the load-bearing filter. `PayoutItem.earningId` is
   * unique so a double-add would throw, but throwing mid-batch after other rows
   * were written is a worse failure than never selecting it.
   */
  findPayableEarnings(input: {
    cycleFrom: Date;
    cycleTo: Date;
    instructorId?: string;
    now: Date;
  }) {
    return this.prisma.earning.findMany({
      where: {
        status: 'PAYABLE',
        payoutItem: null,
        ...(input.instructorId && { instructorId: input.instructorId }),
        // Belt and braces: the PENDING -> PAYABLE cron already respects the
        // dispute window, but a hand-edited row must not slip through.
        OR: [{ payableFrom: null }, { payableFrom: { lte: input.now } }],
        session: {
          sessionDate: { gte: input.cycleFrom, lte: input.cycleTo },
          deletedAt: null,
        },
      },
      orderBy: [{ instructorId: 'asc' }, { createdAt: 'asc' }],
      include: {
        session: {
          select: {
            id: true,
            sessionDate: true,
            service: { select: { name: true } },
          },
        },
      },
    });
  }

  findEarningById(id: string) {
    return this.prisma.earning.findFirst({
      where: { id },
      include: {
        payoutItem: { select: { payoutId: true } },
        instructor: { select: { id: true, name: true } },
      },
    });
  }

  async listEarnings(filter: {
    instructorId?: string;
    status?: EarningStatus;
    from?: Date;
    to?: Date;
    skip: number;
    take: number;
  }) {
    const where: Prisma.EarningWhereInput = {
      ...(filter.instructorId && { instructorId: filter.instructorId }),
      ...(filter.status && { status: filter.status }),
      ...((filter.from || filter.to) && {
        session: {
          sessionDate: {
            ...(filter.from && { gte: filter.from }),
            ...(filter.to && { lte: filter.to }),
          },
        },
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.earning.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: {
          instructor: { select: { id: true, name: true } },
          session: {
            select: {
              id: true,
              sequence: true,
              sessionDate: true,
              booking: { select: { code: true } },
              service: { select: { name: true } },
            },
          },
          // PDF 6.8 asks for "supported payout status information", so the
          // batch's own status rides along — an earning's id alone does not
          // say whether the money has actually moved.
          payoutItem: {
            select: {
              payoutId: true,
              payout: {
                select: {
                  id: true,
                  status: true,
                  cycleFrom: true,
                  cycleTo: true,
                  utr: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.earning.count({ where }),
    ]);

    return { rows, total };
  }

  setEarningStatus(id: string, status: EarningStatus, withheldReason?: string | null) {
    return this.prisma.earning.update({
      where: { id },
      data: {
        status,
        ...(withheldReason !== undefined && { withheldReason }),
      },
    });
  }

  // ----------------------------------------------------------------- payouts

  /**
   * Creates one teacher's batch: the payout, its items, and the earnings moved
   * out of `PAYABLE` — all in one transaction.
   *
   * Earnings stay `PAYABLE` until the money actually leaves (`markPaid` sets
   * `PAID`). Flipping them here would make a `FAILED` payout look settled.
   */
  createBatch(input: {
    instructorId: string;
    cycleFrom: Date;
    cycleTo: Date;
    gross: number;
    tds: number;
    deductions: number;
    net: number;
    items: Array<{ earningId: string; amount: number }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          instructorId: input.instructorId,
          cycleFrom: input.cycleFrom,
          cycleTo: input.cycleTo,
          gross: input.gross,
          tds: input.tds,
          deductions: input.deductions,
          net: input.net,
          status: 'DRAFT',
        },
      });

      await tx.payoutItem.createMany({
        data: input.items.map((item) => ({
          payoutId: payout.id,
          earningId: item.earningId,
          amount: item.amount,
        })),
      });

      // `include` through a nested create does not always infer, so the items
      // are read back inside the same transaction.
      const items = await tx.payoutItem.findMany({
        where: { payoutId: payout.id },
      });

      return { ...payout, items };
    });
  }

  findPayoutById(id: string) {
    return this.prisma.payout.findFirst({
      where: { id },
      include: {
        instructor: {
          select: { id: true, name: true, user: { select: { mobile: true } } },
        },
        approvedBy: { select: { id: true, name: true, email: true } },
        items: {
          include: {
            earning: {
              include: {
                session: {
                  select: {
                    id: true,
                    sequence: true,
                    sessionDate: true,
                    booking: { select: { code: true } },
                    service: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  findPayoutForInstructor(instructorId: string, payoutId: string) {
    return this.prisma.payout.findFirst({
      where: { id: payoutId, instructorId },
      include: {
        items: {
          include: {
            earning: {
              include: {
                session: {
                  select: {
                    id: true,
                    sequence: true,
                    sessionDate: true,
                    booking: { select: { code: true } },
                    service: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /** Used to make batch generation idempotent for a cycle. */
  findPayoutForCycle(instructorId: string, cycleFrom: Date, cycleTo: Date) {
    return this.prisma.payout.findFirst({
      where: { instructorId, cycleFrom, cycleTo },
      select: { id: true, status: true, net: true },
    });
  }

  async listPayouts(filter: {
    instructorId?: string;
    status?: PayoutStatus;
    cycleFrom?: Date;
    skip: number;
    take: number;
  }) {
    const where: Prisma.PayoutWhereInput = {
      ...(filter.instructorId && { instructorId: filter.instructorId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.cycleFrom && { cycleFrom: filter.cycleFrom }),
    };

    const [rows, total, totals] = await this.prisma.$transaction([
      this.prisma.payout.findMany({
        where,
        orderBy: [{ cycleTo: 'desc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.take,
        include: {
          instructor: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.payout.count({ where }),
      // Finance reads the page total far more often than any single row.
      this.prisma.payout.aggregate({
        where,
        _sum: { gross: true, tds: true, net: true },
      }),
    ]);

    return { rows, total, totals: totals._sum };
  }

  updatePayout(id: string, data: Prisma.PayoutUpdateInput) {
    return this.prisma.payout.update({ where: { id }, data });
  }

  /**
   * Settles a payout: status to `PAID` and every earning inside it to `PAID`,
   * atomically. These two must agree — an earning left `PAYABLE` under a paid
   * payout would be picked up by the next batch and paid twice.
   */
  markPaid(input: { payoutId: string; utr: string; paidAt: Date }) {
    return this.prisma.$transaction(async (tx) => {
      const items = await tx.payoutItem.findMany({
        where: { payoutId: input.payoutId },
        select: { earningId: true },
      });

      await tx.earning.updateMany({
        where: { id: { in: items.map((i) => i.earningId) } },
        data: { status: 'PAID' },
      });

      return tx.payout.update({
        where: { id: input.payoutId },
        data: { status: 'PAID', utr: input.utr, paidAt: input.paidAt },
      });
    });
  }

  /**
   * Deletes a draft and releases its earnings back to the pool. `PayoutItem`
   * cascades on payout delete, so the earnings become selectable again simply
   * by the items going away — they were never moved out of `PAYABLE`.
   */
  deleteDraft(payoutId: string) {
    return this.prisma.payout.delete({ where: { id: payoutId } });
  }

  listPayoutsForInstructor(instructorId: string, skip: number, take: number) {
    return this.prisma.$transaction([
      this.prisma.payout.findMany({
        where: { instructorId },
        orderBy: { cycleTo: 'desc' },
        skip,
        take,
        select: {
          id: true,
          cycleFrom: true,
          cycleTo: true,
          gross: true,
          tds: true,
          deductions: true,
          net: true,
          status: true,
          utr: true,
          paidAt: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.payout.count({ where: { instructorId } }),
    ]);
  }

  /** Teachers with payable earnings in the cycle — the batch job's work list. */
  async findInstructorsWithPayableEarnings(input: {
    cycleFrom: Date;
    cycleTo: Date;
    now: Date;
  }) {
    const rows = await this.prisma.earning.groupBy({
      by: ['instructorId'],
      where: {
        status: 'PAYABLE',
        payoutItem: null,
        OR: [{ payableFrom: null }, { payableFrom: { lte: input.now } }],
        session: {
          sessionDate: { gte: input.cycleFrom, lte: input.cycleTo },
          deletedAt: null,
        },
      },
    });
    return rows.map((r) => r.instructorId);
  }

  findInstructorProfileByUserId(userId: string) {
    return this.prisma.instructorProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
  }

  /** Bank details for the transfer. Decrypted by the caller, not here. */
  findBeneficiary(instructorId: string) {
    return this.prisma.document.findFirst({
      where: {
        ownerType: 'INSTRUCTOR',
        ownerId: instructorId,
        docType: 'BANK_DETAILS',
        verifyStatus: 'VERIFIED',
        deletedAt: null,
      },
      select: { id: true, number: true },
    });
  }
}
