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
import { CustomerService, type AdminActor } from './customer.service';
import {
  AdminUpdateCustomerDto,
  BlockCustomerDto,
  ChangeCustomerStatusDto,
  ListCustomersQueryDto,
} from './dto/admin-customer.dto';

/**
 * Customer management (spec 5.3) — the ops-side counterpart to
 * `/app/customer`, which only ever serves the signed-in customer their own
 * record.
 *
 * There is no create route. A customer account is made by OTP signup
 * (`auth.verifyLoginOtp` writes the profile on first login), so an admin
 * "adding" one would be minting an account whose owner cannot sign into it.
 * There is no delete route either: removal is the deletion-request workflow
 * (spec 10.3), with retention rules a table action should not shortcut.
 *
 * Reads need `customers:view`; correcting a profile needs `customers:edit`;
 * suspending an account or blacklisting someone needs `customers:approve` —
 * so the Support Agent role, which the seed gives view/create/edit, can help a
 * caller but cannot lock them out.
 */
@Controller('admin/customers')
@AllowAudience('admin')
export class AdminCustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  @RequirePermissions('customers:view')
  async list(@Query() query: ListCustomersQueryDto) {
    const { rows, meta } = await this.customers.listForAdmin(query);
    return { data: rows, meta };
  }

  /** Profile, account, addresses and the wallet balance. */
  @Get(':id')
  @RequirePermissions('customers:view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.customers.getForAdmin(id) };
  }

  @Patch(':id')
  @RequirePermissions('customers:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateCustomerDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.customers.updateForAdmin(
        id,
        dto,
        this.actor(userId, req),
      ),
      message: 'Customer updated',
    };
  }

  /**
   * Suspend or reinstate the login. The response reports how many refresh
   * tokens were revoked and how many sessions are still booked — a suspension
   * does not cancel them.
   */
  @Post(':id/status')
  @RequirePermissions('customers:approve')
  @HttpCode(200)
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeCustomerStatusDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const result = await this.customers.changeStatusForAdmin(
      id,
      dto,
      this.actor(userId, req),
    );
    return {
      data: result,
      message:
        result.upcomingSessions > 0
          ? `Status updated. ${result.upcomingSessions} upcoming session(s) are still booked.`
          : 'Status updated',
    };
  }

  /**
   * The blacklist. The account keeps working; booking refuses them. Reported
   * with the session count for the same reason as above.
   */
  @Post(':id/block')
  @RequirePermissions('customers:approve')
  @HttpCode(200)
  async setBlocked(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockCustomerDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const result = await this.customers.setBlockedForAdmin(
      id,
      dto,
      this.actor(userId, req),
    );
    return {
      data: result,
      message:
        dto.isBlocked && result.upcomingSessions > 0
          ? `Customer blocked. ${result.upcomingSessions} upcoming session(s) are still booked.`
          : dto.isBlocked
            ? 'Customer blocked'
            : 'Block removed',
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
