import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AdminActor } from './admin-catalog.service';
import type { UpdateServicePricingDto } from './dto/admin-service-pricing.dto';

/**
 * The service rate card — the one write the admin has on a service
 * (client, 17 Nov 2026, restated strictly: **admin sets every price, a
 * provider never does**).
 *
 * This deliberately contradicts PDF 4.5 / US-P06, which give the provider
 * their own pricing. The client's instruction wins here and the override is
 * recorded in `state/pricing-rules.md`; everything else about a service —
 * name, description, inclusions — is still the provider's and is not
 * editable from here.
 *
 * It sits apart from `AdminCatalogService` because that class owns categories
 * and the visibility toggle and is already long.
 */
@Injectable()
export class AdminServicePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async update(id: string, dto: UpdateServicePricingDto, actor: AdminActor) {
    const service = await this.require(id);

    const allowMultiPerson = dto.allowMultiPerson ?? service.allowMultiPerson;
    const maxParticipants = this.resolveMax(
      allowMultiPerson,
      dto.maxParticipants,
      service.maxParticipants,
    );

    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.basePrice !== undefined && { basePrice: dto.basePrice }),
        ...(dto.durationMin !== undefined && { durationMin: dto.durationMin }),
        allowMultiPerson,
        maxParticipants,
      },
      select: {
        id: true,
        name: true,
        basePrice: true,
        durationMin: true,
        allowMultiPerson: true,
        maxParticipants: true,
        isActive: true,
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.service_pricing_updated',
      entityType: 'Service',
      entityId: id,
      before: {
        basePrice: Number(service.basePrice),
        durationMin: service.durationMin,
        allowMultiPerson: service.allowMultiPerson,
        maxParticipants: service.maxParticipants,
      },
      after: {
        basePrice: Number(updated.basePrice),
        durationMin: updated.durationMin,
        allowMultiPerson: updated.allowMultiPerson,
        maxParticipants: updated.maxParticipants,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    // Bookings already made keep the gross they were created with; only the
    // next quote reads the new rate. Said out loud so nobody expects a repipe.
    return { ...updated, basePrice: Number(updated.basePrice) };
  }

  /**
   * The two systems never meet, so the head-count ceiling has to follow the
   * switch: a solo service is pinned to one person, and a group service that
   * tops out at one person would offer a dropdown with a single entry and no
   * slab could ever apply.
   */
  private resolveMax(
    allowMultiPerson: boolean,
    asked: number | undefined,
    current: number,
  ): number {
    if (!allowMultiPerson) {
      if (asked !== undefined && asked > 1) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message:
            'A service priced by package takes one person per session. Turn on allowMultiPerson first.',
        });
      }
      return 1;
    }

    const next = asked ?? current;

    if (next < 2) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A group service needs maxParticipants of at least 2',
      });
    }

    return next;
  }

  private async require(id: string) {
    const row = await this.prisma.service.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
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

    return row;
  }
}
