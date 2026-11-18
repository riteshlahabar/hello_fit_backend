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
        level: true,
        maxParticipants: true,
        isHomeService: true,
        // The website's package picker lists only solo services: a group
        // service prices by slab and `GET /packages?serviceId=` answers it
        // with an empty list.
        allowMultiPerson: true,
        category: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  /**
   * Service detail screen — includes everything shown before booking.
   *
   * Packages are global since 17 Nov 2026 and carry a percentage, not a
   * price, so the choices are derived here rather than read off the service.
   */
  async getService(id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, isActive: true, deletedAt: null },
      include: {
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
      basePrice: Number(service.basePrice),
      allowMultiPerson: service.allowMultiPerson,
      maxParticipants: service.maxParticipants,
    });

    return { ...service, packages: options.packages, groupSlabs: options.groupSlabs };
  }

  /**
   * Every live package, for the website's Package page (client, 17 Nov 2026 —
   * the word "Plans" now means packages).
   *
   * A package is global and holds a percentage, so the list is the same for
   * every service. `serviceId` is optional: give one and each row carries the
   * worked price for that service's rate; leave it out and `price` is null.
   */
  async listPackages(serviceId?: string) {
    if (!serviceId) return this.pricingOptions.listPackages(null);

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true, deletedAt: null },
      select: { basePrice: true, allowMultiPerson: true },
    });

    if (!service) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Service not found',
      });
    }

    // A group service prices off slabs, never off a package — pricing-rules.md.
    // Returning priced packages for one would offer a combination the booking
    // endpoint rejects with a 400.
    if (service.allowMultiPerson) return [];

    return this.pricingOptions.listPackages(Number(service.basePrice));
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
