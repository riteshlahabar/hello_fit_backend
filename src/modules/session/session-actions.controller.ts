import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { InstructorContextService } from '../trainer-app/instructor-context.service';
import { SessionActionsService } from './session-actions.service';

/** The code the customer reads off their own app — four digits, no letters. */
export class CompleteSessionDto {
  @IsNumberString()
  @Length(4, 4)
  otp!: string;
}

/**
 * The reason is compulsory and free text, as on page 34 — the options the
 * sheet lists are a UI affordance and there is no reason master to validate
 * against. `clientAbsent` is the one branch the status depends on, so it is
 * its own field rather than a string the backend has to pattern-match.
 */
export class CancelSessionByTrainerDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  clientAbsent?: boolean;
}

/**
 * Page 32's Completed and Cancel buttons. A controller of its own because
 * `InstructorController` is already the longest file in the module and these
 * two routes answer to the booking-detail screen, not the session-day
 * machine.
 */
@Controller('app/instructor')
@AllowAudience('app')
@Roles('INSTRUCTOR')
export class SessionActionsController {
  constructor(
    private readonly context: InstructorContextService,
    private readonly actions: SessionActionsService,
  ) {}

  @Post('bookings/:id/complete')
  async complete(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: CompleteSessionDto,
  ) {
    const instructorId = await this.context.require(userId);

    return {
      data: await this.actions.complete(instructorId, sessionId, dto.otp),
      message: 'Session completed',
    };
  }

  @Post('bookings/:id/cancel')
  async cancel(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: CancelSessionByTrainerDto,
  ) {
    const instructorId = await this.context.require(userId);
    const result = await this.actions.cancel(instructorId, sessionId, {
      reason: dto.reason,
      clientAbsent: dto.clientAbsent,
    });

    return { data: result, message: 'Session cancelled' };
  }
}
