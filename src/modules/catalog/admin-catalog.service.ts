import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/prisma/client';
import type {
  CreateCategoryDto,
  ListCatalogQueryDto,
  ListServicesQueryDto,
  SetServiceVisibilityDto,
  UpdateCategoryDto,
} from './dto/admin-catalog.dto';

export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Category and service management (PDF 6.5).
 *
 * Deliberately asymmetric, because the PDF is: the admin **owns categories**
 * (create, edit, describe, activate) but only **reviews services** and
 * controls their visibility. 4.5 gives the provider its service's name,
 * description and pricing, so there is no admin edit or create for a service
 * here — adding one would be inventing authority the PDF does not grant.
 *
 * There is no delete either. 6.5 lists create, edit, activate and deactivate;
 * it never mentions deleting a category, and a category with services and
 * historical bookings behind it should be deactivated, not removed.
 */
@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- categories

  async listCategories(query: ListCatalogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ServiceCategoryWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' } }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceCategory.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { services: true } },
        },
      }),
      this.prisma.serviceCategory.count({ where }),
    ]);

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async createCategory(dto: CreateCategoryDto, actor: AdminActor) {
    const slug = slugify(dto.name);
    await this.assertSlugFree(slug);

    const created = await this.prisma.serviceCategory.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        icon: dto.icon,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.category_created',
      entityType: 'ServiceCategory',
      entityId: created.id,
      after: { name: created.name, slug: created.slug },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return created;
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    actor: AdminActor,
  ) {
    const category = await this.requireCategory(id);

    // A rename re-derives the slug, which is a URL key other things point at,
    // so it is checked for a collision the same way a create is.
    let slug: string | undefined;
    if (dto.name && dto.name !== category.name) {
      slug = slugify(dto.name);
      await this.assertSlugFree(slug, id);
    }

    // Deactivating a category hides its services from customers too, so the
    // count is reported rather than left for someone to discover.
    if (dto.isActive === false && category.isActive) {
      const services = await this.prisma.service.count({
        where: { categoryId: id, deletedAt: null, isActive: true },
      });
      if (services > 0) {
        this.logger.warn(
          `Category ${category.slug} deactivated with ${services} active service(s)`,
        );
      }
    }

    const updated = await this.prisma.serviceCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(slug !== undefined && { slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.category_updated',
      entityType: 'ServiceCategory',
      entityId: id,
      before: {
        name: category.name,
        slug: category.slug,
        isActive: category.isActive,
      },
      after: {
        name: updated.name,
        slug: updated.slug,
        isActive: updated.isActive,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  // --------------------------------------------------------------- services

  /** Read-only review (PDF 6.5, "review provider service information"). */
  async listServices(query: ListServicesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ServiceWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' } }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { id: true, name: true, isActive: true } },
          _count: { select: { instructorServices: true, bookings: true } },
        },
      }),
      this.prisma.service.count({ where }),
    ]);

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * The one administrative lever on a service (PDF 6.5, "manage permitted
   * service visibility"). Hiding a service does not touch bookings already
   * made against it — the count is reported so the decision is informed.
   */
  async setServiceVisibility(
    id: string,
    dto: SetServiceVisibilityDto,
    actor: AdminActor,
  ) {
    const service = await this.prisma.service.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, isActive: true },
    });
    if (!service) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
      });
    }

    const updated = await this.prisma.service.update({
      where: { id },
      data: { isActive: dto.isActive },
      include: { category: { select: { id: true, name: true } } },
    });

    const upcomingBookings = await this.prisma.bookingSession.count({
      where: {
        serviceId: id,
        deletedAt: null,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'ASSIGNED'] },
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: dto.isActive ? 'catalog.service_shown' : 'catalog.service_hidden',
      entityType: 'Service',
      entityId: id,
      before: { isActive: service.isActive },
      after: { isActive: updated.isActive },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { ...updated, upcomingBookings };
  }

  // -------------------------------------------------------------- internals

  private async requireCategory(id: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!category) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Category not found',
      });
    }
    return category;
  }

  private async assertSlugFree(slug: string, exceptId?: string) {
    const clash = await this.prisma.serviceCategory.findFirst({
      where: { slug, ...(exceptId && { NOT: { id: exceptId } }) },
      select: { id: true, name: true, deletedAt: true },
    });
    if (clash) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: clash.deletedAt
          ? `A retired category already uses the name "${clash.name}"`
          : `"${clash.name}" already uses that name`,
      });
    }
  }
}

/** Lower-case, hyphenated, ASCII — the shape the public catalog routes read. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
