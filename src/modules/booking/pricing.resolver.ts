import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AddonLine } from './pricing.calculator';
import { loadAddonLines } from './pricing.addons';
import type { QuoteBookingDto } from './dto/booking.dto';

export interface PricedService {
  id: string;
  basePrice: number;
  durationMin: number;
}

export interface PricedPackage {
  id: string;
  sessionCount: number;
  /** People attending each session — the package decides, not the customer. */
  persons: number;
  freeSessionCount: number;
  percentAdjust: number;
  allowedWeekdays: number[];
  validityDays: number;
}

export interface PricingBasis {
  service: PricedService;
  pkg: PricedPackage | null;
  addons: AddonLine[];
  /** Per session, per person — always the admin-set service rate. */
  unitPrice: number;
  participantCount: number;
  /** The package's percent; a booking with no package pays full price. */
  percentAdjust: number;
  /** Sessions the customer pays for. */
  paidSessionCount: number;
  /** Sessions delivered free on top, charged to nobody. */
  freeSessionCount: number;
}

/**
 * Turns a quote request into the figures `pricing.calculator` needs.
 *
 * The rules in one place (client 17 Nov 2026, reshaped 18 Nov): the admin
 * sets every rate, the rate is per session per person, and **the package is
 * the only discount** — it names the services it is sold on and carries its
 * own `persons`. A booking with no package is one person, one session, full
 * price. `GroupSlab` and `Service.allowMultiPerson` were deleted with this
 * change. → `state/pricing-rules.md`
 */
@Injectable()
export class PricingResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(dto: QuoteBookingDto): Promise<PricingBasis> {
    const service = await this.loadService(dto.serviceId);
    const pkg = await this.loadPackage(service, dto.packageId);
    const participantCount = this.resolveParticipants(pkg, dto);

    return {
      service,
      pkg,
      addons: await loadAddonLines(this.prisma, service.id, dto.addonIds),
      unitPrice: service.basePrice,
      participantCount,
      percentAdjust: pkg?.percentAdjust ?? 0,
      paidSessionCount: pkg?.sessionCount ?? dto.sessionCount ?? 1,
      freeSessionCount: pkg?.freeSessionCount ?? 0,
    };
  }

  private async loadService(serviceId: string): Promise<PricedService> {
    const row = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true, deletedAt: null },
      select: { id: true, basePrice: true, durationMin: true },
    });

    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
      });
    }

    return { ...row, basePrice: Number(row.basePrice) };
  }

  /**
   * The head count comes off the package. A request may still send one, but
   * only to agree with the package — a silent mismatch would price a booking
   * for three people and seat one.
   */
  private resolveParticipants(
    pkg: PricedPackage | null,
    dto: QuoteBookingDto,
  ): number {
    const fromPackage = pkg?.persons ?? 1;
    const asked = dto.participantCount;

    if (asked !== undefined && asked !== fromPackage) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: pkg
          ? `This package is for ${fromPackage} person(s) per session`
          : 'Choose a package to book for more than one person',
      });
    }

    return fromPackage;
  }

  /** The package must be live and sold on the service being booked. */
  private async loadPackage(
    service: PricedService,
    packageId: string | undefined,
  ): Promise<PricedPackage | null> {
    if (!packageId) {
      return null;
    }

    const row = await this.prisma.package.findFirst({
      where: {
        id: packageId,
        isActive: true,
        deletedAt: null,
        services: { some: { serviceId: service.id } },
      },
      select: {
        id: true,
        sessionCount: true,
        persons: true,
        freeSessionCount: true,
        percentAdjust: true,
        allowedWeekdays: true,
        validityDays: true,
      },
    });

    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'That package is not offered on this service',
      });
    }

    return { ...row, percentAdjust: Number(row.percentAdjust) };
  }
}
