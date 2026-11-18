import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { slugify, type AdminActor } from './admin-catalog.service';
import type { UpdateServiceDto } from './dto/admin-service-update.dto';

/**
 * Editing a service from the admin panel (client instruction, 18 Nov 2026).
 *
 * **Past the PDF on purpose**, as the create route is: §4.5 gives the
 * provider its service's wording. The client asked for Edit right after Add,
 * because without it no admin can change a catalogue row.
 * → `state/scope-documents.md`
 *
 * Its own class so `AdminCatalogService` (categories, visibility) and
 * `AdminServiceCreateService` both stay short.
 */
@Injectable()
export class AdminServiceUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async update(id: string, dto: UpdateServiceDto, actor: AdminActor) {
    const service = await this.require(id);

    if (dto.categoryId && dto.categoryId !== service.categoryId) {
      await this.requireCategory(dto.categoryId);
    }

    // The slug is the customer-facing key, so a rename moves it with the
    // name rather than leaving the old wording in every URL.
    const slug = dto.name ? slugify(dto.name) : undefined;
    if (slug && slug !== service.slug) await this.assertSlugFree(slug, id);

    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(slug !== undefined && { slug }),
        ...(dto.basePrice !== undefined && { basePrice: dto.basePrice }),
        ...(dto.durationMin !== undefined && { durationMin: dto.durationMin }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.equipment !== undefined && { equipment: dto.equipment }),
        ...(dto.instructions !== undefined && {
          instructions: dto.instructions,
        }),
        ...(dto.allowExtension !== undefined && {
          allowExtension: dto.allowExtension,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        category: { select: { id: true, name: true, isActive: true } },
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.service_updated',
      entityType: 'Service',
      entityId: id,
      before: {
        name: service.name,
        slug: service.slug,
        categoryId: service.categoryId,
        basePrice: Number(service.basePrice),
      },
      after: {
        name: updated.name,
        slug: updated.slug,
        categoryId: updated.categoryId,
        basePrice: Number(updated.basePrice),
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    // Bookings already made keep the gross they were created with; only the
    // next quote reads the new rate.
    return { ...updated, basePrice: Number(updated.basePrice) };
  }

  private async require(id: string) {
    const row = await this.prisma.service.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        categoryId: true,
        basePrice: true,
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

  private async requireCategory(id: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Category not found',
      });
    }
  }

  /** `slug` is unique across the catalogue; the row's own slug is not a clash. */
  private async assertSlugFree(slug: string, selfId: string) {
    const clash = await this.prisma.service.findFirst({
      where: { slug, id: { not: selfId } },
      select: { name: true },
    });

    if (clash) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: `A service called "${clash.name}" already exists`,
      });
    }
  }
}
