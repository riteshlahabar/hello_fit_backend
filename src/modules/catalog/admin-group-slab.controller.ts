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
import { AdminGroupSlabService } from './admin-group-slab.service';
import type { AdminActor } from './admin-catalog.service';
import {
  CreateGroupSlabDto,
  ListGroupSlabsQueryDto,
  SetGroupSlabStatusDto,
  UpdateGroupSlabDto,
} from './dto/admin-group-slab.dto';

/**
 * The Group Slab menu (client pricing doc, 17 Nov 2026) — four routes.
 *
 * Not paged: the table is three or four rows. No delete, same as packages —
 * a booking priced under a slab has to stay explicable.
 */
@Controller('admin/group-slabs')
@AllowAudience('admin')
export class AdminGroupSlabController {
  constructor(private readonly slabs: AdminGroupSlabService) {}

  @Get()
  @RequirePermissions('catalog:view')
  async list(@Query() query: ListGroupSlabsQueryDto) {
    return { data: await this.slabs.list(query) };
  }

  @Post()
  @RequirePermissions('catalog:create')
  async create(
    @Body() dto: CreateGroupSlabDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.slabs.create(dto, this.actor(userId, req)),
      message: 'Group slab saved',
    };
  }

  @Patch(':id')
  @RequirePermissions('catalog:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupSlabDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.slabs.update(id, dto, this.actor(userId, req)),
      message: 'Group slab updated',
    };
  }

  @Patch(':id/status')
  @RequirePermissions('catalog:edit')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetGroupSlabStatusDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.slabs.setStatus(id, dto, this.actor(userId, req)),
      message: dto.isActive
        ? 'Group slab is in use again'
        : 'Group slab retired — the next size down now applies',
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
