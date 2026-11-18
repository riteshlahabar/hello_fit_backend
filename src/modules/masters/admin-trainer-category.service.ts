import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AdminActor } from './masters.service';
import type {
  CreateTrainerCategoryDto,
  ListTrainerCategoriesQueryDto,
  SetTrainerCategoryStatusDto,
  UpdateTrainerCategoryDto,
} from './dto/admin-trainer-category.dto';

/**
 * Trainer bands — Basic / Standard / Premium / Elite (client, 17 Nov 2026).
 *
 * A band holds no money. The rate is `Service.basePrice` whoever delivers the
 * session; the band only selects a `CommissionRule` with scope
 * `TRAINER_CATEGORY`, so one rule covers everyone in it.
 *
 * **No delete**, and deactivation is **refused while providers sit in the
 * band** — the same rule the geography masters follow. A band with providers
 * behind it that quietly went inactive would drop their commission down to
 * the global rule without anybody choosing that.
 */
@Injectable()
export class AdminTrainerCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTrainerCategoriesQueryDto) {
    return this.prisma.trainerCategory.findMany({
      where: {
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { instructors: true, commissionRules: true } },
      },
    });
  }

  async create(dto: CreateTrainerCategoryDto, actor: AdminActor) {
    await this.assertNameFree(dto.name);

    const created = await this.prisma.trainerCategory.create({
      data: {
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'masters.trainer_category_created',
      entityType: 'TrainerCategory',
      entityId: created.id,
      after: { name: created.name, sortOrder: created.sortOrder },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return created;
  }

  async update(id: string, dto: UpdateTrainerCategoryDto, actor: AdminActor) {
    const existing = await this.require(id);

    if (dto.name && dto.name !== existing.name) {
      await this.assertNameFree(dto.name, id);
    }

    const updated = await this.prisma.trainerCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'masters.trainer_category_updated',
      entityType: 'TrainerCategory',
      entityId: id,
      before: { name: existing.name, sortOrder: existing.sortOrder },
      after: { name: updated.name, sortOrder: updated.sortOrder },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  async setStatus(
    id: string,
    dto: SetTrainerCategoryStatusDto,
    actor: AdminActor,
  ) {
    const existing = await this.require(id);

    if (!dto.isActive) {
      await this.assertEmpty(id);
    }

    const updated = await this.prisma.trainerCategory.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: dto.isActive
        ? 'masters.trainer_category_activated'
        : 'masters.trainer_category_deactivated',
      entityType: 'TrainerCategory',
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  // -------------------------------------------------------------- internals

  private async require(id: string) {
    const row = await this.prisma.trainerCategory.findFirst({
      where: { id, deletedAt: null },
    });

    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Trainer category not found',
      });
    }

    return row;
  }

  /** The refusal names the counts, so the admin knows what to move first. */
  private async assertEmpty(id: string) {
    const [providers, rules] = await this.prisma.$transaction([
      this.prisma.instructorProfile.count({
        where: { trainerCategoryId: id, deletedAt: null },
      }),
      this.prisma.commissionRule.count({
        where: { trainerCategoryId: id, isActive: true },
      }),
    ]);

    if (providers > 0 || rules > 0) {
      throw new ConflictException({
        code: ErrorCode.MASTER_IN_USE,
        message: `This band still has ${providers} provider(s) and ${rules} commission rule(s). Move them first.`,
      });
    }
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.trainerCategory.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId && { NOT: { id: exceptId } }),
      },
      select: { id: true, name: true, deletedAt: true },
    });

    if (clash) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: clash.deletedAt
          ? `A retired band already uses the name "${clash.name}"`
          : `A band called "${clash.name}" already exists`,
      });
    }
  }
}
