import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * What the customer may choose from before booking a service, with the price
 * each choice produces (client pricing doc, 17 Nov 2026).
 *
 * Packages and group slabs never appear together: `allowMultiPerson` decides
 * which list is non-empty, so the app shows one dropdown, not two.
 * → `state/pricing-rules.md`
 */
export interface PackageOption {
  id: string;
  name: string;
  /** Card symbol the admin typed; null means the card draws its own. */
  icon: string | null;
  sessionCount: number;
  freeSessionCount: number;
  validityDays: number;
  percentAdjust: number;
  allowedWeekdays: number[];
  fixedInstructorAllowed: boolean;
  /** Derived, never stored: basePrice x sessionCount, then percentAdjust. */
  price: number;
  perSessionPrice: number;
}

/**
 * A package on its own, away from any service — what the website's Package
 * page lists. A package holds a percentage, not a price, so `price` is null
 * until a service supplies the rate it applies to.
 */
export interface PackageSummary extends Omit<PackageOption, 'price' | 'perSessionPrice'> {
  sortOrder: number;
  price: number | null;
  perSessionPrice: number | null;
}

export interface GroupSlabOption {
  minPersons: number;
  percentOff: number;
  /** Price for one session with that many people. */
  sessionPrice: number;
}

export interface PricingOptions {
  basePrice: number;
  allowMultiPerson: boolean;
  maxParticipants: number;
  packages: PackageOption[];
  groupSlabs: GroupSlabOption[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const applyPercent = (amount: number, percent: number): number =>
  round2(amount + (amount * percent) / 100);

const PACKAGE_FIELDS = {
  id: true,
  name: true,
  icon: true,
  sessionCount: true,
  freeSessionCount: true,
  validityDays: true,
  percentAdjust: true,
  allowedWeekdays: true,
  fixedInstructorAllowed: true,
  sortOrder: true,
} as const;

@Injectable()
export class PricingOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async forService(service: {
    basePrice: number;
    allowMultiPerson: boolean;
    maxParticipants: number;
  }): Promise<PricingOptions> {
    return {
      basePrice: service.basePrice,
      allowMultiPerson: service.allowMultiPerson,
      maxParticipants: service.maxParticipants,
      packages: service.allowMultiPerson
        ? []
        : await this.packages(service.basePrice),
      groupSlabs: service.allowMultiPerson
        ? await this.groupSlabs(service.basePrice)
        : [],
    };
  }

  /**
   * Every live package, for the website's Package page.
   *
   * `basePrice` is optional because a package is global: the same -15% applies
   * to whatever the chosen service costs. Pass a rate and the page can show a
   * worked example; pass nothing and it shows the terms only.
   */
  async listPackages(basePrice: number | null): Promise<PackageSummary[]> {
    const rows = await this.activeRows();

    return rows.map((row) => {
      const percentAdjust = Number(row.percentAdjust);
      const price =
        basePrice === null
          ? null
          : applyPercent(basePrice * row.sessionCount, percentAdjust);

      return {
        ...row,
        percentAdjust,
        price,
        perSessionPrice: price === null ? null : round2(price / row.sessionCount),
      };
    });
  }

  private async packages(basePrice: number): Promise<PackageOption[]> {
    const rows = await this.activeRows();

    return rows.map((row) => {
      const percentAdjust = Number(row.percentAdjust);
      const price = applyPercent(basePrice * row.sessionCount, percentAdjust);

      return {
        ...row,
        percentAdjust,
        price,
        // What the customer compares on. Free sessions are excluded: they are
        // delivered, not charged, so counting them would flatter the rate.
        perSessionPrice: round2(price / row.sessionCount),
      };
    });
  }

  private activeRows() {
    return this.prisma.package.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { sessionCount: 'asc' }],
      select: PACKAGE_FIELDS,
    });
  }

  private async groupSlabs(basePrice: number): Promise<GroupSlabOption[]> {
    const rows = await this.prisma.groupSlab.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { minPersons: 'asc' },
      select: { minPersons: true, percentOff: true },
    });

    return rows.map((row) => {
      const percentOff = Number(row.percentOff);

      return {
        minPersons: row.minPersons,
        percentOff,
        sessionPrice: applyPercent(basePrice * row.minPersons, -percentOff),
      };
    });
  }
}
