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
import { AdminServicePricingService } from './admin-service-pricing.service';
import { AdminServiceCreateService } from './admin-service-create.service';
import { CreateServiceDto } from './dto/admin-service.dto';
import { UpdateServicePricingDto } from './dto/admin-service-pricing.dto';
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
 * Six routes. Categories are created and edited here. A service can be
 * **created** (client instruction, 18 Nov 2026), reviewed, priced and made
 * visible or hidden — but **not edited**: 4.5 gives the provider its name,
 * description and inclusions, and only creation and pricing were asked for.
 * Both of those knowingly go past 4.5. → `state/scope-documents.md`
 *
 * No delete for a category either — 6.5 lists create, edit, activate and
 * deactivate, and nothing else.
 */
@Controller('admin/catalog')
@AllowAudience('admin')
export class AdminCatalogController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly servicePricing: AdminServicePricingService,
    private readonly serviceCreate: AdminServiceCreateService,
  ) {}

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

  @Get('services')
  @RequirePermissions('catalog:view')
  async listServices(@Query() query: ListServicesQueryDto) {
    const { rows, meta } = await this.catalog.listServices(query);
    return { data: rows, meta };
  }

  /**
   * Add a service (client instruction, 18 Nov 2026) — past §4.5, which gives
   * the provider its own services, in the same way admin-only pricing is.
   * Editing a service is still not here: the provider owns its wording.
   */
  @Post('services')
  @RequirePermissions('catalog:create')
  async createService(
    @Body() dto: CreateServiceDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.serviceCreate.create(dto, this.actor(userId, req)),
      message: 'Service created',
    };
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

  /**
   * The service rate card — admin-only pricing (client, 17 Nov 2026, restated
   * strictly). A deliberate override of PDF 4.5; see
   * `state/pricing-rules.md`.
   * Name, description and inclusions stay the provider's and are not here.
   */
  @Patch('services/:id/pricing')
  @RequirePermissions('catalog:edit')
  async updateServicePricing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServicePricingDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.servicePricing.update(id, dto, this.actor(userId, req)),
      message: 'Service pricing updated',
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
