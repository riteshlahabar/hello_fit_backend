import {
  Body,
  Controller,
  Delete,
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
import { AdminServiceUpdateService } from './admin-service-update.service';
import { AdminCatalogDeleteService } from './admin-catalog-delete.service';
import { CreateServiceDto } from './dto/admin-service.dto';
import { UpdateServiceDto } from './dto/admin-service-update.dto';
import { UpdateServicePricingDto } from './dto/admin-service-pricing.dto';
import {
  ListServicesQueryDto,
  SetServiceVisibilityDto,
} from './dto/admin-catalog.dto';

/**
 * The service half of catalogue management (PDF 6.5) — categories live in
 * `AdminCatalogController` under the same `admin/catalog` prefix.
 *
 * Six routes. **Create, edit and hard delete all go past §4.5**, which gives
 * the provider its own services and the admin review and visibility only;
 * the client asked for each one (18 Nov 2026), the same way admin-only
 * pricing overrode §4.5 on 17 Nov. → `state/scope-documents.md`
 */
@Controller('admin/catalog')
@AllowAudience('admin')
export class AdminServiceController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly servicePricing: AdminServicePricingService,
    private readonly serviceCreate: AdminServiceCreateService,
    private readonly serviceUpdate: AdminServiceUpdateService,
    private readonly deletes: AdminCatalogDeleteService,
  ) {}

  @Get('services')
  @RequirePermissions('catalog:view')
  async listServices(@Query() query: ListServicesQueryDto) {
    const { rows, meta } = await this.catalog.listServices(query);
    return { data: rows, meta };
  }

  /** Add a service (client, 18 Nov 2026) — past §4.5 on purpose. */
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
   * Edit a service (client, 18 Nov 2026). Every field the Add form has,
   * `allowMultiPerson` included — it decides package versus slab pricing and
   * had no admin control until this route. `:id/pricing` stays for the
   * rate-only screen.
   */
  @Patch('services/:id')
  @RequirePermissions('catalog:edit')
  async updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.serviceUpdate.update(id, dto, this.actor(userId, req)),
      message: 'Service updated',
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

  /**
   * Hard delete, refused while a booking, a session, a trainer link or a
   * commission rule points at the service — the refusal names each count.
   * A service with history is hidden through `:id/visibility` instead.
   */
  @Delete('services/:id')
  @RequirePermissions('catalog:delete')
  async removeService(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.deletes.deleteService(id, this.actor(userId, req)),
      message: 'Service deleted',
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
