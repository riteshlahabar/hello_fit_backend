import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { PayoutService } from './payout.service';
import {
  ApprovePayoutDto,
  FailPayoutDto,
  GeneratePayoutsDto,
  ListEarningsQueryDto,
  ListPayoutsQueryDto,
  MarkPayoutPaidDto,
  WithholdEarningDto,
} from './dto/payout.dto';
import type { AdminActor } from '../instructor/instructor.service';

/**
 * Finance: the earnings ledger, payout batches and the reconciliation actions
 * (spec 3.7, 5.2 Accounts role).
 *
 * Permissions are split deliberately. Reads and generation need
 * `finance:view` / `finance:create` — generating a draft commits nothing.
 * **Approving, paying and failing a payout need `finance:approve`**, because
 * those are the points at which money leaves, and the spec requires a separate
 * sign-off from whoever prepared the batch.
 *
 * Every mutation writes an audit row with before/after, actor, IP and request
 * id. For money that is not optional.
 */
@Controller('admin')
@AllowAudience('admin')
export class AdminPayoutController {
  constructor(private readonly payouts: PayoutService) {}

  // ---------------------------------------------------------------- earnings

  @Get('earnings')
  @RequirePermissions('finance:view')
  async listEarnings(@Query() query: ListEarningsQueryDto) {
    const { rows, meta } = await this.payouts.listEarnings(query);
    return { data: rows, meta };
  }

  /** Holds one earning out of every future batch. */
  @Post('earnings/:id/withhold')
  @RequirePermissions('finance:edit')
  @HttpCode(200)
  async withhold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithholdEarningDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.payouts.withholdEarning(
        id,
        dto,
        this.actor(adminUserId, req),
      ),
      message: 'Earning withheld',
    };
  }

  @Post('earnings/:id/release')
  @RequirePermissions('finance:edit')
  @HttpCode(200)
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.payouts.releaseEarning(id, this.actor(adminUserId, req)),
      message: 'Earning released',
    };
  }

  // ----------------------------------------------------------------- payouts

  @Get('payouts')
  @RequirePermissions('finance:view')
  async list(@Query() query: ListPayoutsQueryDto) {
    const { rows, meta } = await this.payouts.listPayouts(query);
    return { data: rows, meta };
  }

  /**
   * Builds the drafts for a cycle. Same code path as the weekly job, so running
   * it by hand reproduces the job rather than being a second implementation.
   * `dryRun: true` returns what *would* be created and writes nothing.
   */
  @Post('payouts/generate')
  @RequirePermissions('finance:create')
  @HttpCode(200)
  async generate(
    @Body() dto: GeneratePayoutsDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    const result = await this.payouts.generateForCycle(
      dto,
      this.actor(adminUserId, req),
    );
    const created = result.results.filter((r) => r.payoutId && !r.skipped);
    return {
      data: result,
      meta: {
        created: created.length,
        skipped: result.results.length - created.length,
        netTotal: created.reduce((sum, r) => sum + r.net, 0),
      },
      message: result.dryRun
        ? `${created.length} batch(es) would be created`
        : `${created.length} draft payout(s) created`,
    };
  }

  /** Detail plus the statement and what finance may do with it next. */
  @Get('payouts/:id')
  @RequirePermissions('finance:view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.payouts.getPayout(id) };
  }

  @Post('payouts/:id/approve')
  @RequirePermissions('finance:approve')
  @HttpCode(200)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePayoutDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.payouts.approve(
        id,
        dto.remark,
        this.actor(adminUserId, req),
      ),
      message: 'Payout approved',
    };
  }

  /**
   * Hands the batch to the payout rail. With the manual rail this records the
   * intent and the response says a human still has to move the money.
   */
  @Post('payouts/:id/initiate')
  @RequirePermissions('finance:approve')
  @HttpCode(200)
  async initiate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    const result = await this.payouts.initiate(id, this.actor(adminUserId, req));
    return {
      data: result,
      message: result.requiresManualTransfer
        ? 'Payout initiated. Make the bank transfer, then record the UTR.'
        : 'Payout sent to the payout gateway',
    };
  }

  /** Records a settled transfer. Moves every earning inside it to PAID. */
  @Post('payouts/:id/paid')
  @RequirePermissions('finance:approve')
  @HttpCode(200)
  async markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPayoutPaidDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.payouts.markPaid(id, dto, this.actor(adminUserId, req)),
      message: 'Payout marked paid',
    };
  }

  @Post('payouts/:id/fail')
  @RequirePermissions('finance:approve')
  @HttpCode(200)
  async fail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailPayoutDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.payouts.fail(id, dto, this.actor(adminUserId, req)),
      message: 'Payout marked failed. The earnings are back in the pool.',
    };
  }

  /** Discards a draft and returns its earnings to the pool. Drafts only. */
  @Delete('payouts/:id')
  @RequirePermissions('finance:delete')
  @HttpCode(200)
  async deleteDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.payouts.deleteDraft(id, this.actor(adminUserId, req)),
      message: 'Draft payout deleted',
    };
  }

  /**
   * On an admin route the token subject is the `AdminUser.id`, so
   * `@CurrentUser` already gives the audit row its actor.
   */
  private actor(adminUserId: string, req: Request): AdminActor {
    return {
      adminUserId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }
}
