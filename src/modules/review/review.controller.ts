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
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  AllowAudience,
  CurrentUser,
  Public,
  RequirePermissions,
  Roles,
} from '../../common/decorators/auth.decorators';
import { ReviewService } from './review.service';
import { ListReviewsQueryDto } from './dto/admin-review.dto';
import {
  EditReviewDto,
  ModerateReviewDto,
  ReplyReviewDto,
  ReportReviewDto,
  SubmitReviewDto,
} from './dto/review.dto';

/** Customer side of the review system (spec 6.2, Bookings tab). */
@Controller('app/customer')
@AllowAudience('app')
@Roles('CUSTOMER')
export class CustomerReviewController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('reviews/criteria')
  async criteria() {
    return { data: await this.reviews.criteriaFor('CUSTOMER_TO_INSTRUCTOR') };
  }

  /** Completed sessions still awaiting this customer's review. */
  @Get('reviews/pending')
  async pending(@CurrentUser('id') userId: string) {
    const customerId = await this.customerId(userId);
    const sessions = await this.reviews.pendingFor('CUSTOMER', customerId);

    return { data: sessions, meta: { count: sessions.length } };
  }

  @Post('reviews')
  async submit(
    @Body() dto: SubmitReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    const result = await this.reviews.submit('CUSTOMER', customerId, dto);

    return {
      data: result,
      message: result.flagged
        ? 'Thanks. Your review is being checked before it appears.'
        : 'Thanks for your review.',
    };
  }

  @Patch('reviews/:id')
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    return { data: await this.reviews.edit('CUSTOMER', customerId, id, dto) };
  }

  /** My reviews, and the teacher replies to them (spec 6.2, Profile tab). */
  @Get('reviews/mine')
  async mine(@CurrentUser('id') userId: string) {
    const customerId = await this.customerId(userId);

    const rows = await this.prisma.review.findMany({
      where: { authorType: 'CUSTOMER', authorId: customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        overallRating: true,
        comment: true,
        tags: true,
        state: true,
        publishedAt: true,
        editLockedAt: true,
        reply: true,
        repliedAt: true,
        session: {
          select: {
            sessionDate: true,
            service: { select: { name: true } },
            instructor: { select: { name: true, photoUrl: true } },
          },
        },
      },
    });

    return { data: rows, meta: { count: rows.length } };
  }

  @Post('reviews/:id/report')
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    const result = await this.reviews.report(
      'CUSTOMER',
      customerId,
      id,
      dto.reason,
    );

    return { data: result, message: 'Reported for moderation' };
  }

  private async customerId(userId: string): Promise<string> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Complete your profile first',
      });
    }

    return profile.id;
  }
}

/** Instructor side: reviews given and received (spec 6.3, Profile tab). */
@Controller('app/instructor')
@AllowAudience('app')
@Roles('INSTRUCTOR')
export class InstructorReviewController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('reviews/criteria')
  async criteria() {
    return { data: await this.reviews.criteriaFor('INSTRUCTOR_TO_CUSTOMER') };
  }

  @Get('reviews/pending')
  async pending(@CurrentUser('id') userId: string) {
    const instructorId = await this.instructorId(userId);
    const sessions = await this.reviews.pendingFor('INSTRUCTOR', instructorId);

    return { data: sessions, meta: { count: sessions.length } };
  }

  @Post('reviews')
  async submit(
    @Body() dto: SubmitReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.instructorId(userId);
    const result = await this.reviews.submit('INSTRUCTOR', instructorId, dto);

    return { data: result, message: 'Review submitted' };
  }

  @Patch('reviews/:id')
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.instructorId(userId);
    return {
      data: await this.reviews.edit('INSTRUCTOR', instructorId, id, dto),
    };
  }

  /** My ratings and every published customer review of me. */
  @Get('reviews/received')
  async received(@CurrentUser('id') userId: string) {
    const instructorId = await this.instructorId(userId);
    const result = await this.reviews.publicReviewsOf(instructorId, 50);

    return { data: result };
  }

  @Post('reviews/:id/reply')
  async reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.instructorId(userId);
    return {
      data: await this.reviews.reply(instructorId, id, dto.text),
      message: 'Reply posted',
    };
  }

  /**
   * Advisory on a customer before arriving: band and tags only. The raw trust
   * score and other teachers' confidential notes are deliberately absent
   * (spec 4.3).
   */
  @Get('customers/:id/advisory')
  async advisory(
    @Param('id', ParseUUIDPipe) customerId: string,
    @CurrentUser('id') userId: string,
  ) {
    const instructorId = await this.instructorId(userId);

    // Only for a customer this teacher actually has a session with.
    const related = await this.prisma.bookingSession.count({
      where: {
        instructorId,
        deletedAt: null,
        booking: { customerId },
      },
    });

    if (related === 0) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'No session with this customer',
      });
    }

    return { data: await this.reviews.customerAdvisoryFor(customerId) };
  }

  private async instructorId(userId: string): Promise<string> {
    const profile = await this.prisma.instructorProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'No instructor profile on this account',
      });
    }

    return profile.id;
  }
}

/** Public teacher profile reviews — browsable before signing in. */
@Controller()
export class PublicReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Public()
  @Get('instructors/:id/reviews')
  async forInstructor(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 20;

    return { data: await this.reviews.publicReviewsOf(id, take) };
  }
}

/** Moderation queue and decisions (spec 5.7). */
@Controller('admin')
@AllowAudience('admin')
export class AdminReviewController {
  constructor(private readonly reviews: ReviewService) {}

  /**
   * PDF 6.10 — the review table. Customer-to-provider only; the
   * instructor-to-customer direction and its confidential note are never
   * returned here.
   */
  @RequirePermissions('reviews:view')
  @Get('reviews')
  async list(@Query() query: ListReviewsQueryDto) {
    const { rows, meta } = await this.reviews.listForAdmin(query);
    return { data: rows, meta };
  }

  @RequirePermissions('reviews:view')
  @Get('reviews/moderation-queue')
  async queue() {
    const rows = await this.reviews.moderationQueue();
    return { data: rows, meta: { count: rows.length } };
  }

  @RequirePermissions('reviews:approve')
  @Post('reviews/:id/approve')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateReviewDto,
    @CurrentUser('id') adminUserId: string,
  ) {
    return {
      data: await this.reviews.approve(adminUserId, id, dto.reason),
      message: 'Review approved',
    };
  }

  @RequirePermissions('reviews:edit')
  @Post('reviews/:id/hide')
  async hide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateReviewDto,
    @CurrentUser('id') adminUserId: string,
  ) {
    return {
      data: await this.reviews.hide(adminUserId, id, dto.reason),
      message: 'Review hidden',
    };
  }
}
