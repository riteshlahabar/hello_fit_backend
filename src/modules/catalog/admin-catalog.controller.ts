import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { AdminCatalogService, type AdminActor } from './admin-catalog.service';
import {
  CreateCategoryDto,
  ListCatalogQueryDto,
  ListServicesQueryDto,
  SetServiceVisibilityDto,
  UpdateCategoryDto,
} from './dto/admin-catalog.dto';

/**
 * Category and service management (PDF 6.5).
 *
 * Five routes, and the asymmetry between them is the PDF's: categories are
 * created and edited here, services are only reviewed and made visible or
 * hidden. 4.5 gives the provider the service's name, description and pricing,
 * so there is no admin create, edit or delete for a service.
 *
 * No delete for a category either — 6.5 lists create, edit, activate and
 * deactivate, and nothing else.
 */
@Controller('admin/catalog')
@AllowAudience('admin')
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get('categories')
  @RequirePermissions('catalog:view')
  async listCategories(@Query() query: ListCatalogQueryDto) {
    const { rows, meta } = await this.catalog.listCategories(query);
    return { data: rows, meta };
  }

  @Post('categories')
  @RequirePermissions('catalog:create')
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.catalog.createCategory(dto, this.actor(userId, req)),
      message: 'Category created',
    };
  }

  /** Also the activate / deactivate route — `isActive` is a field on it. */
  @Patch('categories/:id')
  @RequirePermissions('catalog:edit')
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.catalog.updateCategory(id, dto, this.actor(userId, req)),
      message: 'Category updated',
    };
  }

  /** Review only. */
  @Get('services')
  @RequirePermissions('catalog:view')
  async listServices(@Query() query: ListServicesQueryDto) {
    const { rows, meta } = await this.catalog.listServices(query);
    return { data: rows, meta };
  }

  /**
   * Show or hide a service. Reports how many sessions are already booked
   * against it — hiding does not cancel them.
   */
  @Post('services/:id/visibility')
  @RequirePermissions('catalog:edit')
  @HttpCode(200)
  async setServiceVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetServiceVisibilityDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const result = await this.catalog.setServiceVisibility(
      id,
      dto,
      this.actor(userId, req),
    );
    return {
      data: result,
      message:
        !dto.isActive && result.upcomingBookings > 0
          ? `Service hidden. ${result.upcomingBookings} session(s) are already booked and are unaffected.`
          : dto.isActive
            ? 'Service is visible to customers'
            : 'Service hidden from customers',
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
