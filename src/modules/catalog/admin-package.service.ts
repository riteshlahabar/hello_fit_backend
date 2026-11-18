import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../../generated/prisma/client';
import type { AdminActor } from './admin-catalog.service';
import {
  assertPackageNameFree,
  packageUpdateData,
  packageView,
  requirePackage,
} from './admin-package.helpers';
import type {
  CreatePackageDto,
  ListPackagesQueryDto,
  SetPackageStatusDto,
  UpdatePackageDto,
} from './dto/admin-package.dto';

/**
 * Package management (client pricing doc, 17 Nov 2026).
 *
 * Six global rows — trial, weekly, monthly, monthly intensive and the two
 * 90-day plans. A package holds a **percent**, never a price: the rupees come
 * from `Service.basePrice`, so one row prices every service.
 *
 * **No delete route.** A booking keeps its `packageId` and the invoice behind
 * it has to stay explicable; a package leaves the catalogue by going inactive.
 */
@Injectable()
export class AdminPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListPackagesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PackageWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' } }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.package.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { sessionCount: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { bookings: true } } },
      }),
      this.prisma.package.count({ where }),
    ]);

    return {
      rows: rows.map(packageView),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async create(dto: CreatePackageDto, actor: AdminActor) {
    await assertPackageNameFree(this.prisma, dto.name);

    const created = await this.prisma.package.create({
      data: {
        name: dto.name,
        icon: dto.icon || null,
        sessionCount: dto.sessionCount,
        validityDays: dto.validityDays,
        percentAdjust: dto.percentAdjust ?? 0,
        freeSessionCount: dto.freeSessionCount ?? 0,
        allowedWeekdays: dto.allowedWeekdays ?? [],
        fixedInstructorAllowed: dto.fixedInstructorAllowed ?? true,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.package_created',
      entityType: 'Package',
      entityId: created.id,
      after: {
        name: created.name,
        sessionCount: created.sessionCount,
        percentAdjust: Number(created.percentAdjust),
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return packageView(created);
  }

  async update(id: string, dto: UpdatePackageDto, actor: AdminActor) {
    const existing = await requirePackage(this.prisma, id);

    if (dto.name && dto.name !== existing.name) {
      await assertPackageNameFree(this.prisma, dto.name, id);
    }

    const updated = await this.prisma.package.update({
      where: { id },
      data: packageUpdateData(dto),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.package_updated',
      entityType: 'Package',
      entityId: id,
      before: {
        name: existing.name,
        sessionCount: existing.sessionCount,
        percentAdjust: Number(existing.percentAdjust),
      },
      after: {
        name: updated.name,
        sessionCount: updated.sessionCount,
        percentAdjust: Number(updated.percentAdjust),
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return packageView(updated);
  }

  /**
   * Activate or deactivate. A package already booked is never removed from
   * the data — deactivating only takes it off the customer's dropdown, and
   * the count of bookings behind it is reported so the call is informed.
   */
  async setStatus(id: string, dto: SetPackageStatusDto, actor: AdminActor) {
    const existing = await requirePackage(this.prisma, id);

    const updated = await this.prisma.package.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    const bookings = await this.prisma.booking.count({
      where: { packageId: id, deletedAt: null },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: dto.isActive
        ? 'catalog.package_activated'
        : 'catalog.package_deactivated',
      entityType: 'Package',
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { ...packageView(updated), bookings };
  }
}
