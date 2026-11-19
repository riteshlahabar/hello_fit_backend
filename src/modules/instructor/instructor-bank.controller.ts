import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { UpsertBankAccountDto } from './dto/instructor-bank.dto';
import { InstructorBankService } from './instructor-bank.service';

/**
 * The provider's own payout destination (trainer app page 20).
 *
 * Resolved from the token like the rest of `/app/instructor/*` — no instructor
 * id is accepted from the path, so one provider cannot read another's account.
 */
@Controller('app/instructor/bank-account')
@AllowAudience('app')
export class InstructorBankController {
  constructor(private readonly bank: InstructorBankService) {}

  /** `data` is null until the provider has saved an account. */
  @Get()
  @Roles('INSTRUCTOR')
  async getOwn(@CurrentUser('id') userId: string) {
    return { data: await this.bank.getOwn(userId) };
  }

  @Put()
  @Roles('INSTRUCTOR')
  async upsertOwn(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertBankAccountDto,
  ) {
    return {
      data: await this.bank.upsertOwn(userId, dto),
      message: 'Bank account saved',
    };
  }
}
