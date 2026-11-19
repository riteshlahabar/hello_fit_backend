import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { PricingOptionsService } from './pricing-options';

/**
 * Read side of the service catalog. Admin CRUD lands in a separate
 * admin-facing service so the customer-facing queries stay narrow and
 * cacheable.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingOptions: PricingOptionsService,
  ) {}

  /** Category grid on the customer Home tab (spec 6.2). */
  async listCategories() {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        imageUrl: true,
        description: true,
        _count: { select: { services: { where: { isActive: true } } } },
      },
    });
  }

  async listServices(params: { categoryId?: string; search?: string }) {
    return this.prisma.service.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
        ...(params.search
          ? { name: { contains: params.search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        durationMin: true,
        basePrice: true,
        description: true,
        category: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  /**
   * Service detail screen — includes everything shown before booking.
   *
   * A package names the services it is sold on (client, 18 Nov 2026) and
   * carries its own `persons`, so the prices are derived here.
   */
  async getService(id: string) {
    // A `select`, not an `include`: the commission the trainer earns is
    // internal and an `include` would put it in front of every visitor.
    const service = await this.prisma.service.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        categoryId: true,
        durationMin: true,
        basePrice: true,
        description: true,
        equipment: true,
        instructions: true,
        allowExtension: true,
        isActive: true,
        category: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!service) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
      });
    }

    const options = await this.pricingOptions.forService({
      id: service.id,
      basePrice: Number(service.basePrice),
    });

    return { ...service, packages: options.packages };
  }

  /**
   * The website's Package page (client, 17 Nov 2026 — the word "Plans" now
   * means packages; reshaped 18 Nov).
   *
   * `serviceId` is optional. Give one and the list narrows to the packages
   * that service is sold on, each carrying the worked price for its rate;
   * leave it out and every live package comes back with `price` null.
   */
  async listPackages(serviceId?: string) {
    if (!serviceId) return this.pricingOptions.listPackages(null);

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true, deletedAt: null },
      select: { basePrice: true },
    });

    if (!service) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
      });
    }

    return this.pricingOptions.listPackages(
      Number(service.basePrice),
      serviceId,
    );
  }

  /** Add-ons offered for a service; an empty list on the add-on means "all". */
  async listAddonsForService(serviceId: string) {
    const addons = await this.prisma.addon.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        applicableServiceIds: true,
      },
    });

    return addons.filter(
      (addon) =>
        addon.applicableServiceIds.length === 0 ||
        addon.applicableServiceIds.includes(serviceId),
    );
  }
}
