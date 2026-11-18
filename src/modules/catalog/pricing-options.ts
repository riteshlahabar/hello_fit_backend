import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * What the customer may choose from before booking a service, with the price
 * each choice produces (client pricing doc 17 Nov 2026, reshaped 18 Nov).
 *
 * **A package is the only discount there is.** It names the services it is
 * sold on and carries its own `persons`, so a group deal is simply a package
 * with persons above 1 — `GroupSlab` and the service's `allowMultiPerson`
 * switch were both deleted in the same change. A package with no service
 * ticked is sold nowhere. → `state/pricing-rules.md`
 */
export interface PackageOption {
  id: string;
  name: string;
  /** Card symbol the admin typed; null means the card draws its own. */
  icon: string | null;
  sessionCount: number;
  /** People attending each session on this package. */
  persons: number;
  freeSessionCount: number;
  validityDays: number;
  percentAdjust: number;
  allowedWeekdays: number[];
  fixedInstructorAllowed: boolean;
  /**
   * Derived, never stored: basePrice x persons x sessionCount, then
   * percentAdjust.
   */
  price: number;
  perSessionPrice: number;
}

/**
 * A package on its own, away from any service — what the website's Package
 * page lists. A package holds a percentage, not a price, so `price` is null
 * until a service supplies the rate it applies to.
 */
export interface PackageSummary
  extends Omit<PackageOption, 'price' | 'perSessionPrice'> {
  sortOrder: number;
  price: number | null;
  perSessionPrice: number | null;
  /** The services it is sold on; empty means it is sold nowhere. */
  services: { id: string; name: string }[];
}

export interface PricingOptions {
  basePrice: number;
  packages: PackageOption[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const applyPercent = (amount: number, percent: number): number =>
  round2(amount + (amount * percent) / 100);

const PACKAGE_FIELDS = {
  id: true,
  name: true,
  icon: true,
  sessionCount: true,
  persons: true,
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
    id: string;
    basePrice: number;
  }): Promise<PricingOptions> {
    return {
      basePrice: service.basePrice,
      packages: await this.packages(service.id, service.basePrice),
    };
  }

  /**
   * Every live package, for the website's Package page.
   *
   * `basePrice` is optional: pass a rate and the page can show a worked
   * example, pass nothing and it shows the terms only. The services each
   * package is sold on come back either way, because that is now the thing
   * that decides where it appears.
   */
  async listPackages(
    basePrice: number | null,
    serviceId?: string,
  ): Promise<PackageSummary[]> {
    const rows = await this.prisma.package.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(serviceId && { services: { some: { serviceId } } }),
      },
      orderBy: [{ sortOrder: 'asc' }, { sessionCount: 'asc' }],
      select: {
        ...PACKAGE_FIELDS,
        services: {
          select: { service: { select: { id: true, name: true } } },
        },
      },
    });

    return rows.map((row) => {
      const percentAdjust = Number(row.percentAdjust);
      const price =
        basePrice === null ? null : this.gross(basePrice, row, percentAdjust);

      return {
        ...row,
        percentAdjust,
        price,
        perSessionPrice:
          price === null ? null : round2(price / row.sessionCount),
        services: row.services.map((link) => link.service),
      };
    });
  }

  /** Only the packages ticked for this service — none means none shown. */
  private async packages(
    serviceId: string,
    basePrice: number,
  ): Promise<PackageOption[]> {
    const rows = await this.prisma.package.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        services: { some: { serviceId } },
      },
      orderBy: [{ sortOrder: 'asc' }, { sessionCount: 'asc' }],
      select: PACKAGE_FIELDS,
    });

    return rows.map((row) => {
      const percentAdjust = Number(row.percentAdjust);
      const price = this.gross(basePrice, row, percentAdjust);

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

  /** The one money rule: rate x people x sessions, then the percentage. */
  private gross(
    basePrice: number,
    row: { sessionCount: number; persons: number },
    percentAdjust: number,
  ): number {
    return applyPercent(
      basePrice * row.persons * row.sessionCount,
      percentAdjust,
    );
  }
}
