import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { AdminTrainerCategoryService } from './admin-trainer-category.service';
import type { AdminActor } from './masters.service';
import {
  CreateTrainerCategoryDto,
  ListTrainerCategoriesQueryDto,
  SetTrainerCategoryStatusDto,
  UpdateTrainerCategoryDto,
} from './dto/admin-trainer-category.dto';

/**
 * The Trainer Category menu (client, 17 Nov 2026) — four routes.
 *
 * Master data, so it sits with the other masters and under `masters:*`:
 * there is no `settings` permission module in the seed, and inventing one
 * would leave every existing role unable to see the screen.
 *
 * Not paged — four bands. No delete; a band leaves through `:id/status`, and
 * only once nothing points at it.
 */
@Controller('admin/trainer-categories')
@AllowAudience('admin')
export class AdminTrainerCategoryController {
  constructor(private readonly bands: AdminTrainerCategoryService) {}

  @Get()
  @RequirePermissions('masters:view')
  async list(@Query() query: ListTrainerCategoriesQueryDto) {
    return { data: await this.bands.list(query) };
  }

  @Post()
  @RequirePermissions('masters:create')
  async create(
    @Body() dto: CreateTrainerCategoryDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.bands.create(dto, this.actor(userId, req)),
      message: 'Trainer category created',
    };
  }

  @Patch(':id')
  @RequirePermissions('masters:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrainerCategoryDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.bands.update(id, dto, this.actor(userId, req)),
      message: 'Trainer category updated',
    };
  }

  @Patch(':id/status')
  @RequirePermissions('masters:edit')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTrainerCategoryStatusDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.bands.setStatus(id, dto, this.actor(userId, req)),
      message: dto.isActive
        ? 'Trainer category is in use again'
        : 'Trainer category retired',
    };
  }

  private actor(userId: string, req: Request): AdminActor {
    return {
      adminUserId: userId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }
}
