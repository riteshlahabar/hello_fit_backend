import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { CouponService, type AdminActor } from './coupon.service';
import {
  CreateCouponDto,
  ListCouponsQueryDto,
  SetCouponStatusDto,
  UpdateCouponDto,
} from './dto/coupon.dto';

/**
 * Coupons and promotional settings (PDF 6.9).
 *
 * Guarded by the **`marketing`** module, which the seed already grants to
 * Super Admin and Content Editor (spec 5.8) — no new permission rows.
 *
 * On an `/admin/*` route `@CurrentUser('id')` is already the `AdminUser.id`.
 */
@Controller('admin/coupons')
@AllowAudience('admin')
export class AdminCouponController {
  constructor(private readonly coupons: CouponService) {}

  private actorOf(adminUserId: string, req: Request): AdminActor {
    return {
      adminUserId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }

  @Get()
  @RequirePermissions('marketing:view')
  async list(@Query() query: ListCouponsQueryDto) {
    const { rows, meta } = await this.coupons.list(query);
    return { data: rows, meta };
  }

  @Post()
  @RequirePermissions('marketing:create')
  async create(
    @Body() dto: CreateCouponDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.coupons.create(dto, this.actorOf(adminUserId, req)),
      message: 'Coupon created',
    };
  }

  @Patch(':id')
  @RequirePermissions('marketing:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.coupons.update(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Coupon updated',
    };
  }

  @Post(':id/status')
  @RequirePermissions('marketing:edit')
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCouponStatusDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.coupons.setStatus(
        id,
        dto.isActive,
        this.actorOf(adminUserId, req),
      ),
      message: dto.isActive ? 'Coupon activated' : 'Coupon deactivated',
    };
  }

  @Delete(':id')
  @RequirePermissions('marketing:delete')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.coupons.remove(id, this.actorOf(adminUserId, req)),
      message: 'Coupon retired',
    };
  }
}
