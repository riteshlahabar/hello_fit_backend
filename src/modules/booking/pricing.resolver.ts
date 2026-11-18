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
  allowMultiPerson: boolean;
  maxParticipants: number;
}

export interface PricedPackage {
  id: string;
  sessionCount: number;
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
  /** The single percent that applies: package adjust OR group slab, never both. */
  percentAdjust: number;
  /** Sessions the customer pays for. */
  paidSessionCount: number;
  /** Sessions delivered free on top, charged to nobody. */
  freeSessionCount: number;
}

/**
 * Turns a quote request into the figures `pricing.calculator` needs.
 *
 * The client's 17 Nov rules in one place: admin sets every rate, the rate is
 * per session per person, and exactly one percentage system applies —
 * `Service.allowMultiPerson` off means packages (persons locked at 1), on
 * means group slabs (no package). → `state/pricing-rules.md`
 */
@Injectable()
export class PricingResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(dto: QuoteBookingDto): Promise<PricingBasis> {
    const service = await this.loadService(dto.serviceId);
    const participantCount = this.resolveParticipants(service, dto);
    const pkg = await this.loadPackage(service, dto.packageId);

    // One percent only. A multi-person service hides packages, so the two
    // branches can never both contribute.
    const percentAdjust = service.allowMultiPerson
      ? -(await this.groupPercentOff(participantCount))
      : (pkg?.percentAdjust ?? 0);

    return {
      service,
      pkg,
      addons: await loadAddonLines(this.prisma, service.id, dto.addonIds),
      unitPrice: service.basePrice,
      participantCount,
      percentAdjust,
      paidSessionCount: pkg?.sessionCount ?? dto.sessionCount ?? 1,
      freeSessionCount: pkg?.freeSessionCount ?? 0,
    };
  }

  private async loadService(serviceId: string): Promise<PricedService> {
    const row = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true, deletedAt: null },
      select: {
        id: true,
        basePrice: true,
        durationMin: true,
        allowMultiPerson: true,
        maxParticipants: true,
      },
    });

    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
      });
    }

    return { ...row, basePrice: Number(row.basePrice) };
  }

  private resolveParticipants(
    service: PricedService,
    dto: QuoteBookingDto,
  ): number {
    const asked = dto.participantCount ?? 1;

    if (!service.allowMultiPerson && asked > 1) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'This service is priced for one person per session',
      });
    }

    if (asked > service.maxParticipants && service.allowMultiPerson) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `This service takes at most ${service.maxParticipants} people per session`,
      });
    }

    return asked;
  }

  private async loadPackage(
    service: PricedService,
    packageId: string | undefined,
  ): Promise<PricedPackage | null> {
    if (!packageId) {
      return null;
    }

    // A group service prices by head count, not by session count, so the two
    // can never be combined — the app hides the package dropdown for it.
    if (service.allowMultiPerson) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Packages do not apply to a group service',
      });
    }

    const row = await this.prisma.package.findFirst({
      where: { id: packageId, isActive: true, deletedAt: null },
      select: {
        id: true,
        sessionCount: true,
        freeSessionCount: true,
        percentAdjust: true,
        allowedWeekdays: true,
        validityDays: true,
      },
    });

    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Package not found',
      });
    }

    return { ...row, percentAdjust: Number(row.percentAdjust) };
  }

  /**
   * Highest slab at or below the group size; a size below every slab pays
   * full price. Positive percent means cheaper.
   */
  private async groupPercentOff(participantCount: number): Promise<number> {
    const slab = await this.prisma.groupSlab.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        minPersons: { lte: participantCount },
      },
      orderBy: { minPersons: 'desc' },
      select: { percentOff: true },
    });

    return slab ? Number(slab.percentOff) : 0;
  }
}
