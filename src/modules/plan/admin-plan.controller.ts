import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import {
  CreatePlanDto,
  ListPlansQueryDto,
  ReplacePlanFeaturesDto,
  UpdatePlanDto,
} from './dto/plan.dto';
import { PlanService, type AdminActor } from './plan.service';

/**
 * Plans, administered — client instruction, 13 Nov 2026.
 *
 * Guarded by **`marketing`**, the same module as coupons: both are things an
 * administrator publishes to the public website, and the seed already grants
 * it to Super Admin and Content Editor. No new permission rows.
 *
 * There is **no delete route.** A plan a customer has chosen cannot vanish
 * without orphaning that choice, and `isActive: false` already takes it off
 * the website — which is what "remove it" actually means here.
 */
@Controller('admin/plans')
@AllowAudience('admin')
export class AdminPlanController {
  constructor(private readonly plans: PlanService) {}

  private actorOf(adminUserId: string, req: Request): AdminActor {
    return {
      adminUserId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }

  @Get()
  @RequirePermissions('marketing:view')
  async list(@Query() query: ListPlansQueryDto) {
    const rows = await this.plans.listForAdmin(query);
    return { data: rows, meta: { total: rows.length } };
  }

  @Post()
  @RequirePermissions('marketing:create')
  async create(
    @Body() dto: CreatePlanDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.plans.create(dto, this.actorOf(adminUserId, req)),
      message: 'Plan created',
    };
  }

  @Patch(':id')
  @RequirePermissions('marketing:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.plans.update(id, dto, this.actorOf(adminUserId, req)),
      message: 'Plan updated',
    };
  }

  /** The ✓/– dialog. Sends the whole list; see ReplacePlanFeaturesDto. */
  @Put(':id/features')
  @RequirePermissions('marketing:edit')
  async replaceFeatures(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplacePlanFeaturesDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.plans.replaceFeatures(
        id,
        dto.features,
        this.actorOf(adminUserId, req),
      ),
      message: 'Features updated',
    };
  }
}
