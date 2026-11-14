import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  Public,
  Roles,
} from '../../common/decorators/auth.decorators';
import { PlanService } from './plan.service';

/**
 * The public Plans page — client instruction, 13 Nov 2026.
 *
 * `@Public()` on the list because the page is reachable before signing in:
 * the whole point of the page is to be read by someone deciding whether to
 * join, and the CTA sends them to `/login` afterwards.
 */
@Controller('plans')
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Public()
  @Get()
  async list() {
    const rows = await this.plans.listPublic();

    return {
      data: rows,
      meta: { empty: rows.length === 0 },
      message: rows.length === 0 ? 'No plans are published yet' : null,
    };
  }

  /** What this customer chose. `null` when they have not chosen — not a 404. */
  @Get('mine')
  @AllowAudience('app')
  @Roles('CUSTOMER')
  async mine(@CurrentUser('id') userId: string) {
    return { data: await this.plans.chosen(userId) };
  }

  /**
   * "Continue with Plus". Records the choice and **charges nothing** — there
   * is no gateway subscription behind this by design.
   */
  @Post(':id/choose')
  @AllowAudience('app')
  @Roles('CUSTOMER')
  @HttpCode(HttpStatus.OK)
  async choose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    const chosen = await this.plans.choose(userId, id);

    return { data: chosen, message: `You are on the ${chosen.name} plan` };
  }
}
