import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { AuditService } from '../audit/audit.service';
import {
  CreatePlanDto,
  ListPlansQueryDto,
  PlanFeatureDto,
  UpdatePlanDto,
} from './dto/plan.dto';
import { PlanRepository } from './plan.repository';
import { planCreateFields, planFields } from './plan.fields';
import { uniqueSlug } from './plan-slug';
import { toCard, toAdminRow } from './plan.view';

export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Membership plans — the website's Plans page and its admin screen.
 *
 * Client instruction, 13 Nov 2026; not in the v3 PDF (state/open-points.md).
 *
 * **Choosing a plan charges nothing.** `choose()` writes one foreign key. No
 * gateway subscription, no renewal, no expiry, no proration. That was settled
 * with the client rather than assumed, and it is why this file is short.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly repo: PlanRepository,
    private readonly audit: AuditService,
  ) {}

  /** Public — the three cards. */
  async listPublic() {
    const rows = await this.repo.findPublic();
    return rows.map(toCard);
  }

  async listForAdmin(query: ListPlansQueryDto) {
    // The filter arrives as the literal string — see ListPlansQueryDto.
    const rows = await this.repo.findMany(
      query.isActive === undefined ? {} : { isActive: query.isActive === 'true' },
    );

    // One count query per plan: there are three of them, and a groupBy here
    // would be optimising a list that cannot grow large.
    return Promise.all(
      rows.map(async (row) => toAdminRow(row, await this.repo.countCustomers(row.id))),
    );
  }

  async create(dto: CreatePlanDto, actor: AdminActor) {
    const slug = await uniqueSlug(dto.name, async (candidate) =>
      Boolean(await this.repo.findBySlug(candidate)),
    );

    const plan = await this.repo.create(planCreateFields(dto, slug));

    if (dto.isPopular) await this.repo.clearPopularExcept(plan.id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'plan.created',
      entityType: 'Plan',
      entityId: plan.id,
      after: { name: plan.name, slug: plan.slug },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return toAdminRow(plan, 0);
  }

  async update(id: string, dto: UpdatePlanDto, actor: AdminActor) {
    const before = await this.requirePlan(id);

    // The slug follows a rename, so the public URL matches the visible name.
    const slug =
      dto.name && dto.name !== before.name
        ? await uniqueSlug(dto.name, async (candidate) => {
            const found = await this.repo.findBySlug(candidate);
            return Boolean(found) && found?.id !== id;
          })
        : undefined;

    const plan = await this.repo.update(id, { ...planFields(dto), ...(slug ? { slug } : {}) });

    if (dto.isPopular) await this.repo.clearPopularExcept(plan.id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'plan.updated',
      entityType: 'Plan',
      entityId: plan.id,
      before: {
        name: before.name,
        priceMonthly: before.priceMonthly,
        isActive: before.isActive,
        isPopular: before.isPopular,
      },
      after: {
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        isActive: plan.isActive,
        isPopular: plan.isPopular,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return toAdminRow(plan, await this.repo.countCustomers(plan.id));
  }

  async replaceFeatures(id: string, features: PlanFeatureDto[], actor: AdminActor) {
    await this.requirePlan(id);

    await this.repo.replaceFeatures(
      id,
      features.map((f) => ({ label: f.label, included: f.included ?? true })),
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'plan.features_replaced',
      entityType: 'Plan',
      entityId: id,
      after: { count: features.length },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    const plan = await this.repo.findOne(id);
    return toAdminRow(plan!, await this.repo.countCustomers(id));
  }

  /**
   * Record the customer's choice — "Continue with Plus".
   *
   * An inactive plan is refused: it is not on the website, so a request naming
   * one did not come from a card the customer saw.
   */
  async choose(userId: string, planId: string) {
    const plan = await this.requirePlan(planId);

    if (!plan.isActive) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'That plan is not available',
      });
    }

    const customer = await this.repo.customerByUserId(userId);

    if (!customer) {
      throw new BadRequestException({
        code: ErrorCode.PROFILE_REQUIRED,
        message: 'Complete your profile before choosing a plan',
      });
    }

    await this.repo.setCustomerPlan(customer.id, plan.id);

    return { planId: plan.id, name: plan.name, slug: plan.slug };
  }

  /** What the customer chose, for the dashboard. Null is a normal answer. */
  async chosen(userId: string) {
    const customer = await this.repo.customerByUserId(userId);
    if (!customer?.planId) return null;

    const plan = await this.repo.findOne(customer.planId);
    return plan ? toCard(plan) : null;
  }

  private async requirePlan(id: string) {
    const plan = await this.repo.findOne(id);

    if (!plan) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Plan not found',
      });
    }

    return plan;
  }
}
