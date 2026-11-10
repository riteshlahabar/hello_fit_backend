import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { PayoutService } from './payout.service';

/**
 * The teacher's own payouts and statements.
 *
 * Scoped by the profile resolved from the token, never by an id in the path —
 * `getOwnPayout` looks up `(instructorId, payoutId)` together, so another
 * teacher's payout id returns 404 rather than someone else's earnings.
 *
 * Mounted at `/app/instructor/payouts` alongside the existing earnings list in
 * the session module; this adds the batch view that earnings list rolls up into.
 */
@Controller('app/instructor/payouts')
@AllowAudience('app')
@Roles('INSTRUCTOR')
export class InstructorPayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Get()
  async list(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const { rows, meta } = await this.payouts.listOwnPayouts(
      userId,
      Math.max(1, page),
      Math.min(Math.max(1, limit), 100),
    );
    return { data: rows, meta };
  }

  /** The full statement: every session in the batch, with TDS and the net. */
  @Get(':payoutId')
  async detail(
    @CurrentUser('id') userId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
  ) {
    return { data: await this.payouts.getOwnPayout(userId, payoutId) };
  }
}
