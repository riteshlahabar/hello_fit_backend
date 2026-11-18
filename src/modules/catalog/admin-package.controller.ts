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
import { AdminPackageService } from './admin-package.service';
import type { AdminActor } from './admin-catalog.service';
import {
  CreatePackageDto,
  ListPackagesQueryDto,
  SetPackageStatusDto,
  UpdatePackageDto,
} from './dto/admin-package.dto';

/**
 * The Package menu (client pricing doc, 17 Nov 2026) — four routes.
 *
 * No delete: a booking points at its package and the invoice has to stay
 * explicable, so a package leaves the catalogue through `:id/status`.
 */
@Controller('admin/packages')
@AllowAudience('admin')
export class AdminPackageController {
  constructor(private readonly packages: AdminPackageService) {}

  @Get()
  @RequirePermissions('catalog:view')
  async list(@Query() query: ListPackagesQueryDto) {
    const { rows, meta } = await this.packages.list(query);
    return { data: rows, meta };
  }

  @Post()
  @RequirePermissions('catalog:create')
  async create(
    @Body() dto: CreatePackageDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.packages.create(dto, this.actor(userId, req)),
      message: 'Package created',
    };
  }

  @Patch(':id')
  @RequirePermissions('catalog:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackageDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.packages.update(id, dto, this.actor(userId, req)),
      message: 'Package updated',
    };
  }

  @Patch(':id/status')
  @RequirePermissions('catalog:edit')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPackageStatusDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const result = await this.packages.setStatus(
      id,
      dto,
      this.actor(userId, req),
    );

    return {
      data: result,
      message:
        !dto.isActive && result.bookings > 0
          ? `Package deactivated. ${result.bookings} booking(s) already use it and are unaffected.`
          : dto.isActive
            ? 'Package is available to customers'
            : 'Package hidden from customers',
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
