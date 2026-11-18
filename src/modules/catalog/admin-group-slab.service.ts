import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/prisma/client';
import type { AdminActor } from './admin-catalog.service';
import type {
  CreateGroupSlabDto,
  ListGroupSlabsQueryDto,
  SetGroupSlabStatusDto,
  UpdateGroupSlabDto,
} from './dto/admin-group-slab.dto';

const view = <T extends { percentOff: Prisma.Decimal }>(row: T) => ({
  ...row,
  percentOff: Number(row.percentOff),
});

/**
 * Group-slab management (client pricing doc, 17 Nov 2026).
 *
 * A handful of rows, so the list is not paged — three slabs behind a pager
 * would be theatre. `minPersons` is the row's identity and is unique in the
 * database: two rows for the same size would make the discount depend on row
 * order. To move a size, retire the row and add the new one.
 *
 * **No delete route**, same reason as packages: a booking priced under a slab
 * has to stay explicable.
 */
@Injectable()
export class AdminGroupSlabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListGroupSlabsQueryDto) {
    const rows = await this.prisma.groupSlab.findMany({
      where: {
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { minPersons: 'asc' },
    });

    return rows.map(view);
  }

  /**
   * The unique index on `minPersons` counts retired rows too, so a size that
   * was once used and soft-deleted is revived rather than refused — a second
   * row could never be inserted anyway.
   */
  async create(dto: CreateGroupSlabDto, actor: AdminActor) {
    const existing = await this.prisma.groupSlab.findUnique({
      where: { minPersons: dto.minPersons },
    });

    if (existing && !existing.deletedAt) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: `A slab for ${dto.minPersons} people already exists`,
      });
    }

    const saved = existing
      ? await this.prisma.groupSlab.update({
          where: { id: existing.id },
          data: {
            percentOff: dto.percentOff,
            isActive: dto.isActive ?? true,
            deletedAt: null,
          },
        })
      : await this.prisma.groupSlab.create({
          data: {
            minPersons: dto.minPersons,
            percentOff: dto.percentOff,
            isActive: dto.isActive ?? true,
          },
        });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: existing ? 'catalog.group_slab_revived' : 'catalog.group_slab_created',
      entityType: 'GroupSlab',
      entityId: saved.id,
      after: {
        minPersons: saved.minPersons,
        percentOff: Number(saved.percentOff),
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return view(saved);
  }

  /** Only the percent is editable; the size is the row's identity. */
  async update(id: string, dto: UpdateGroupSlabDto, actor: AdminActor) {
    const existing = await this.require(id);

    const updated = await this.prisma.groupSlab.update({
      where: { id },
      data: { percentOff: dto.percentOff },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'catalog.group_slab_updated',
      entityType: 'GroupSlab',
      entityId: id,
      before: { percentOff: Number(existing.percentOff) },
      after: { percentOff: Number(updated.percentOff) },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return view(updated);
  }

  /**
   * Deactivating a slab does not raise a price already quoted — a booking
   * keeps the gross it was created with. It only changes what the next
   * group-size dropdown offers, and the next size down then applies.
   */
  async setStatus(id: string, dto: SetGroupSlabStatusDto, actor: AdminActor) {
    const existing = await this.require(id);

    const updated = await this.prisma.groupSlab.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: dto.isActive
        ? 'catalog.group_slab_activated'
        : 'catalog.group_slab_deactivated',
      entityType: 'GroupSlab',
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return view(updated);
  }

  private async require(id: string) {
    const row = await this.prisma.groupSlab.findFirst({
      where: { id, deletedAt: null },
    });

    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Group slab not found',
      });
    }

    return row;
  }
}
