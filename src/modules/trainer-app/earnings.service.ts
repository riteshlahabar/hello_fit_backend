import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { formatDate } from '../../common/dates/format';
import { money } from './trainer-view';
import {
  monthSeries,
  periodWindow,
  toTransactions,
  type EarningsPeriod,
} from './earnings.view';

/** Page 57 — Earnings Dashboard, and the figures page 58 heads its list with. */
@Injectable()
export class TrainerEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async summary(instructorId: string, period: EarningsPeriod = 'month') {
    const { from, to, previousFrom } = periodWindow(period);
    const { earningsChartMonths } = this.settings.get('trainerApp');

    const [current, previous, byStatus, chart, transactions, nextPayout] =
      await Promise.all([
        this.window(instructorId, from, to),
        this.window(instructorId, previousFrom, from),
        this.prisma.earning.groupBy({
          by: ['status'],
          where: { instructorId },
          _sum: { netAmount: true },
          _count: { _all: true },
        }),
        this.chartRows(instructorId, earningsChartMonths),
        this.transactionRows(instructorId),
        this.prisma.payout.findFirst({
          where: {
            instructorId,
            status: { in: ['DRAFT', 'APPROVED', 'INITIATED'] },
          },
          orderBy: { cycleTo: 'asc' },
          select: { id: true, net: true, cycleTo: true, status: true },
        }),
      ]);

    const totals = Object.fromEntries(
      byStatus.map((row) => [row.status, money(row._sum.netAmount)]),
    ) as Record<string, number>;

    const sessions = current._count._all;
    const net = money(current._sum.netAmount);
    const was = money(previous._sum.netAmount);

    return {
      period,
      total: net,
      /** Null rather than 0% when there is no previous period to compare to. */
      changePercent: was > 0 ? Number((((net - was) / was) * 100).toFixed(1)) : null,
      availableBalance: totals.PAYABLE ?? 0,
      pendingAmount: totals.PENDING ?? 0,
      withheldAmount: totals.WITHHELD ?? 0,
      paidToDate: totals.PAID ?? 0,
      completedSessions: sessions,
      averagePerSession: sessions > 0 ? Math.round(net / sessions) : 0,
      chart: monthSeries(chart, earningsChartMonths),
      transactions,
      nextPayout: nextPayout
        ? {
            id: nextPayout.id,
            amount: money(nextPayout.net),
            status: nextPayout.status,
            expectedOn: formatDate(nextPayout.cycleTo),
          }
        : null,
    };
  }

  /** Net and count of the earnings created inside one half-open window. */
  private window(instructorId: string, from: Date, to: Date) {
    return this.prisma.earning.aggregate({
      where: { instructorId, createdAt: { gte: from, lt: to } },
      _sum: { netAmount: true },
      _count: { _all: true },
    });
  }

  private async chartRows(instructorId: string, months: number) {
    const from = new Date();
    from.setUTCDate(1);
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCMonth(from.getUTCMonth() - (months - 1));

    return this.prisma.earning.findMany({
      where: { instructorId, createdAt: { gte: from } },
      select: { netAmount: true, createdAt: true },
    });
  }

  /**
   * Page 57's "Recent transactions" and page 58's list: earnings in, payouts
   * out, merged and sorted. Two queries rather than a union — they are
   * different tables with different columns, and 20 rows each is cheap.
   */
  private async transactionRows(instructorId: string) {
    const [earnings, payouts] = await Promise.all([
      this.prisma.earning.findMany({
        where: { instructorId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          netAmount: true,
          status: true,
          createdAt: true,
          session: {
            select: {
              sessionDate: true,
              service: { select: { name: true } },
              booking: { select: { customer: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.payout.findMany({
        where: { instructorId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          net: true,
          status: true,
          createdAt: true,
          paidAt: true,
          utr: true,
        },
      }),
    ]);

    return toTransactions(earnings, payouts);
  }
}
