import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { slugify, type AdminActor } from './admin-catalog.service';
import type { CreateServiceDto } from './dto/admin-service.dto';

/**
 * Creating a service from the admin panel (client instruction, 18 Nov 2026).
 *
 * **Past the PDF on purpose.** §4.5 gives the provider its own services and
 * §6.5 gives the admin review and visibility only, which is why there was no
 * create route until now. The client asked for the button, as they did for
 * admin-only pricing on 17 Nov. → `state/scope-documents.md`
 *
 * Its own class rather than a method on `AdminCatalogService`, which already
 * owns categories and the visibility toggle and is long enough.
 */
@Injectable()
export class AdminServiceCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateServiceDto, actor: AdminActor) {
    await this.requireCategory(dto.categoryId);

    const slug = slugify(dto.name);
    await this.assertSlugFree(slug);

    const created = await this.prisma.service.create({
      data: {
        categoryId: dto.categoryId,
        name: dto.name,
        slug,
        basePrice: dto.basePrice,
        durationMin: dto.durationMin,
        description: dto.description,
        equipment: dto.equipment,
        instructions: dto.instructions,
        allowExtension: dto.allowExtension ?? false,
        isActive: dto.isActive ?? true,
      },
      include: { category: { select: { id: true, name: true, isActive: true } } },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.service_created',
      entityType: 'Service',
      entityId: created.id,
      after: {
        name: created.name,
        slug: created.slug,
        basePrice: Number(created.basePrice),
        categoryId: created.categoryId,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { ...created, basePrice: Number(created.basePrice) };
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

  /** `slug` is unique across the catalogue and is the customer-facing key. */
  private async assertSlugFree(slug: string) {
    const clash = await this.prisma.service.findFirst({
      where: { slug },
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
