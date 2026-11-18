import {
  Body,
  Controller,
  Delete,
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
import { AdminCatalogDeleteService } from './admin-catalog-delete.service';
import type { AdminActor } from './admin-catalog.service';
import {
  CreatePackageDto,
  ListPackagesQueryDto,
  SetPackageStatusDto,
  UpdatePackageDto,
} from './dto/admin-package.dto';

/**
 * The Package menu (client pricing doc, 17 Nov 2026) — five routes.
 *
 * Delete is hard (client, 18 Nov 2026) but refused while a booking points
 * at the package — the invoice has to stay explicable, so a used package
 * leaves the catalogue through `:id/status` instead.
 */
@Controller('admin/packages')
@AllowAudience('admin')
export class AdminPackageController {
  constructor(
    private readonly packages: AdminPackageService,
    private readonly deletes: AdminCatalogDeleteService,
  ) {}

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

  /**
   * Hard delete (client, 18 Nov 2026) — refused with the booking count when a
   * booking points at the package. `:id/status` is still the way to retire a
   * package that has been used.
   */
  @Delete(':id')
  @RequirePermissions('catalog:delete')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.deletes.deletePackage(id, this.actor(userId, req)),
      message: 'Package deleted',
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
