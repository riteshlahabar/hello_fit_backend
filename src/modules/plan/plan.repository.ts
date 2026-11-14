import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Features always come back in the order the design draws them. */
const WITH_FEATURES = {
  features: { orderBy: { sortOrder: 'asc' } as const },
} satisfies Prisma.PlanInclude;

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The website's cards: active plans only, in their administered order. */
  findPublic() {
    return this.prisma.plan.findMany({
      where: { isActive: true, deletedAt: null },
      include: WITH_FEATURES,
      orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
    });
  }

  findMany(where: Prisma.PlanWhereInput) {
    return this.prisma.plan.findMany({
      where: { ...where, deletedAt: null },
      include: WITH_FEATURES,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  findOne(id: string) {
    return this.prisma.plan.findFirst({
      where: { id, deletedAt: null },
      include: WITH_FEATURES,
    });
  }

  findBySlug(slug: string) {
    return this.prisma.plan.findFirst({ where: { slug, deletedAt: null } });
  }

  create(data: Prisma.PlanUncheckedCreateInput) {
    return this.prisma.plan.create({ data, include: WITH_FEATURES });
  }

  update(id: string, data: Prisma.PlanUncheckedUpdateInput) {
    return this.prisma.plan.update({ where: { id }, data, include: WITH_FEATURES });
  }

  /**
   * Clear the ribbon everywhere except `keepId`.
   *
   * The schema cannot express "at most one row where `isPopular`" portably, so
   * it is enforced here — and enforced by *clearing the others* rather than by
   * refusing the write. An administrator ticking "popular" on a second plan
   * means they want it moved, not an error.
   */
  clearPopularExcept(keepId: string) {
    return this.prisma.plan.updateMany({
      where: { isPopular: true, id: { not: keepId } },
      data: { isPopular: false },
    });
  }

  /** Replace a plan's feature list wholesale — the dialog sends all rows. */
  replaceFeatures(planId: string, rows: { label: string; included: boolean }[]) {
    return this.prisma.$transaction([
      this.prisma.planFeature.deleteMany({ where: { planId } }),
      this.prisma.planFeature.createMany({
        data: rows.map((row, index) => ({
          planId,
          label: row.label,
          included: row.included,
          sortOrder: index,
        })),
      }),
    ]);
  }

  /** How many customers chose this plan — shown on the admin row. */
  countCustomers(planId: string) {
    return this.prisma.customerProfile.count({ where: { planId } });
  }

  setCustomerPlan(customerProfileId: string, planId: string) {
    return this.prisma.customerProfile.update({
      where: { id: customerProfileId },
      data: { planId },
      select: { id: true, planId: true },
    });
  }

  customerByUserId(userId: string) {
    return this.prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true, planId: true },
    });
  }
}
