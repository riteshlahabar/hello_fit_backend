import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate } from '../../common/dates/calendar';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { AssignmentService } from '../assignment/assignment.service';
import { InstructorContextService } from '../trainer-app/instructor-context.service';
import { SessionService } from './session.service';

export class CheckInDto {
  @IsString()
  @Length(4, 4)
  otp!: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  /** Required when the geo-fence fails; recorded and flagged to ops. */
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  overrideReason?: string;
}

export class CheckOutDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class DeclineOfferDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class DutyDto {
  @IsBoolean()
  onDuty!: boolean;
}

export class NotesDto {
  @IsString()
  @MaxLength(4000)
  notes!: string;
}

/** Instructor-mode endpoints (spec 6.3). */
@Controller('app/instructor')
@AllowAudience('app')
@Roles('INSTRUCTOR')
export class InstructorController {
  constructor(
    private readonly sessions: SessionService,
    private readonly assignment: AssignmentService,
    private readonly prisma: PrismaService,
    private readonly context: InstructorContextService,
  ) {}

  /** Today tab: the day's timeline. */
  @Get('today')
  async today(@CurrentUser('id') userId: string, @Query('date') date?: string) {
    const instructorId = await this.resolveInstructorId(userId);
    const sessions = await this.sessions.todayForInstructor(
      instructorId,
      date ? parseCalendarDate(date) : undefined,
    );

    return { data: sessions, meta: { count: sessions.length } };
  }

  @Patch('duty')
  async duty(@Body() dto: DutyDto, @CurrentUser('id') userId: string) {
    const instructorId = await this.resolveInstructorId(userId);
    return { data: await this.sessions.setDutyStatus(instructorId, dto.onDuty) };
  }

  /** Requests tab: pending offers with their countdowns. */
  @Get('offers')
  async offers(@CurrentUser('id') userId: string) {
    const instructorId = await this.resolveInstructorId(userId);
    const offers = await this.assignment.listOffersForInstructor(instructorId);

    return { data: offers, meta: { count: offers.length } };
  }

  @Post('offers/:id/accept')
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.resolveInstructorId(userId);
    return {
      data: await this.assignment.accept(instructorId, id),
      message: 'Session accepted',
    };
  }

  @Post('offers/:id/decline')
  async decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineOfferDto,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.resolveInstructorId(userId);
    return {
      data: await this.assignment.decline(instructorId, id, dto.reason),
      message: 'Offer declined',
    };
  }

  @Post('sessions/:id/start-travel')
  async startTravel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.resolveInstructorId(userId);
    return {
      data: await this.sessions.startTravel(instructorId, id),
      message: 'Travel started',
    };
  }

  @Post('sessions/:id/check-in')
  async checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckInDto,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.resolveInstructorId(userId);
    return {
      data: await this.sessions.checkIn(instructorId, id, dto),
      message: 'Checked in',
    };
  }

  @Post('sessions/:id/check-out')
  async checkOut(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckOutDto,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.resolveInstructorId(userId);
    return {
      data: await this.sessions.checkOut(instructorId, id, dto),
      message: 'Session completed',
    };
  }

  @Patch('sessions/:id/notes')
  async notes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NotesDto,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.resolveInstructorId(userId);
    return { data: await this.sessions.saveNotes(instructorId, id, dto.notes) };
  }

  /** Earnings tab: session-wise rows and the running totals. */
  @Get('earnings')
  async earnings(@CurrentUser('id') userId: string) {
    const instructorId = await this.resolveInstructorId(userId);

    const [rows, totals] = await Promise.all([
      this.prisma.earning.findMany({
        where: { instructorId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          sessionValue: true,
          commissionAmount: true,
          deductions: true,
          netAmount: true,
          status: true,
          payableFrom: true,
          createdAt: true,
          session: {
            select: {
              sessionDate: true,
              fromMinute: true,
              service: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.earning.groupBy({
        by: ['status'],
        where: { instructorId },
        _sum: { netAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      data: rows,
      meta: {
        totals: totals.map((t) => ({
          status: t.status,
          count: t._count._all,
          netAmount: t._sum.netAmount,
        })),
      },
    };
  }

  /**
   * The token carries the User id; sessions hang off InstructorProfile.
   * Resolution moved to [InstructorContextService] on 20-11-2026 — the
   * trainer-app tabs needed the same lookup plus a lenient variant, and two
   * copies of an authorisation check is one too many.
   */
  private resolveInstructorId(userId: string): Promise<string> {
    return this.context.require(userId);
  }
}
