import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/prisma/client';
import {
  NEUTRAL_TRUST_SCORE,
  autoFlagReasons,
  canEdit,
  clampTrustScore,
  computeAggregate,
  decidePublishing,
  needsLowRatingAlert,
  trustBandFor,
  trustDeltaFor,
} from './review.calculator';
import type { SubmitReviewDto } from './dto/review.dto';
import type { ListReviewsQueryDto } from './dto/admin-review.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Criteria the app renders for a direction (admin-configurable). */
  async criteriaFor(direction: 'CUSTOMER_TO_INSTRUCTOR' | 'INSTRUCTOR_TO_CUSTOMER') {
    return this.prisma.reviewCriteria.findMany({
      where: { direction, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        isMandatory: true,
        sortOrder: true,
      },
    });
  }

  /**
   * Sessions this author has completed but not yet reviewed. Drives the
   * "pending review" prompt in both shells.
   */
  async pendingFor(authorType: 'CUSTOMER' | 'INSTRUCTOR', authorId: string) {
    const windowDays = this.settings.get('review').windowDays;
    const since = new Date(Date.now() - windowDays * 86_400_000);

    return this.prisma.bookingSession.findMany({
      where: {
        status: 'COMPLETED',
        deletedAt: null,
        completedAt: { gte: since },
        ...(authorType === 'CUSTOMER'
          ? { booking: { customerId: authorId } }
          : { instructorId: authorId }),
        // No review from this side yet.
        reviews: { none: { authorType, deletedAt: null } },
      },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        sessionDate: true,
        fromMinute: true,
        completedAt: true,
        service: { select: { name: true } },
        instructor: { select: { id: true, name: true, photoUrl: true } },
        booking: {
          select: {
            id: true,
            code: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * Submits a review. Stored hidden; publishing is decided afterwards by the
   * double-blind rule, which may also publish the counter-party's held review
   * in the same breath.
   */
  async submit(
    authorType: 'CUSTOMER' | 'INSTRUCTOR',
    authorId: string,
    dto: SubmitReviewDto,
  ) {
    const policy = this.settings.get('review');

    const session = await this.prisma.bookingSession.findFirst({
      where: { id: dto.sessionId, deletedAt: null },
      select: {
        id: true,
        bookingId: true,
        status: true,
        completedAt: true,
        instructorId: true,
        booking: { select: { customerId: true } },
      },
    });

    if (!session) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
    }

    if (session.status !== 'COMPLETED') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'You can only review a completed session',
      });
    }

    // Only the two people who were actually there may review it.
    const isCustomer =
      authorType === 'CUSTOMER' && session.booking.customerId === authorId;
    const isInstructor =
      authorType === 'INSTRUCTOR' && session.instructorId === authorId;

    if (!isCustomer && !isInstructor) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'You were not part of this session',
      });
    }

    const completedAt = session.completedAt ?? new Date();
    const windowClosesAt = new Date(
      completedAt.getTime() + policy.windowDays * 86_400_000,
    );

    if (new Date() > windowClosesAt) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `The ${policy.windowDays}-day review window for this session has closed`,
      });
    }

    const existing = await this.prisma.review.findUnique({
      where: { sessionId_authorType: { sessionId: session.id, authorType } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: 'You have already reviewed this session. Edit it instead.',
      });
    }

    const direction =
      authorType === 'CUSTOMER'
        ? ('CUSTOMER_TO_INSTRUCTOR' as const)
        : ('INSTRUCTOR_TO_CUSTOMER' as const);

    const subjectId =
      authorType === 'CUSTOMER'
        ? (session.instructorId as string)
        : session.booking.customerId;

    if (!subjectId) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'This session has no counterpart to review',
      });
    }

    const criteria = await this.prisma.reviewCriteria.findMany({
      where: { direction, isActive: true, deletedAt: null },
      select: { id: true, slug: true, isMandatory: true },
    });

    const provided = new Map(
      (dto.criteria ?? []).map((entry) => [entry.slug, entry.score]),
    );

    const missing = criteria
      .filter((c) => c.isMandatory && !provided.has(c.slug))
      .map((c) => c.slug);

    if (missing.length > 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Some required ratings are missing',
        details: { missing },
      });
    }

    const flags = autoFlagReasons(
      { overallRating: dto.overallRating, comment: dto.comment },
      policy,
    );

    const now = new Date();

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          sessionId: session.id,
          bookingId: session.bookingId,
          authorType,
          authorId,
          subjectType:
            authorType === 'CUSTOMER'
              ? ('INSTRUCTOR' as const)
              : ('CUSTOMER' as const),
          subjectId,
          direction,
          overallRating: dto.overallRating,
          comment: dto.comment,
          photos: dto.photos ?? [],
          tags: dto.tags ?? [],
          recommendAgain: dto.recommendAgain,
          // Teacher-to-customer only, and never shown to the customer.
          confidentialNote:
            authorType === 'INSTRUCTOR' ? dto.confidentialNote : null,
          state: flags.length > 0 ? 'FLAGGED' : 'SUBMITTED',
          flagReason: flags.length > 0 ? flags.join(', ') : null,
          submittedAt: now,
          editLockedAt: new Date(
            now.getTime() + policy.editLockHours * 3_600_000,
          ),
        },
      });

      for (const entry of dto.criteria ?? []) {
        const match = criteria.find((c) => c.slug === entry.slug);
        if (!match) continue;

        await tx.reviewCriteriaScore.create({
          data: {
            reviewId: created.id,
            criteriaId: match.id,
            score: entry.score,
          },
        });
      }

      return created;
    });

    // A flagged review waits for a moderator rather than publishing.
    const published =
      flags.length > 0 ? { published: false } : await this.tryPublish(session.id);

    this.logger.log(
      `Review ${review.id} submitted (${direction}) state=${review.state}${
        flags.length ? ` flags=${flags.join(',')}` : ''
      }`,
    );

    return {
      id: review.id,
      state: review.state,
      flagged: flags.length > 0,
      flagReasons: flags,
      visibleToCounterparty: published.published,
      editableUntil: review.editLockedAt,
    };
  }

  /** Edits a review inside the 24-hour window. */
  async edit(
    authorType: 'CUSTOMER' | 'INSTRUCTOR',
    authorId: string,
    reviewId: string,
    dto: Partial<SubmitReviewDto>,
  ) {
    const policy = this.settings.get('review');

    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, authorType, authorId, deletedAt: null },
    });

    if (!review) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Review not found',
      });
    }

    if (!canEdit(review, new Date(), policy)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Reviews can only be edited within ${policy.editLockHours} hours of submitting`,
      });
    }

    const nextRating = dto.overallRating ?? review.overallRating;
    const nextComment = dto.comment ?? review.comment;

    const flags = autoFlagReasons(
      { overallRating: nextRating, comment: nextComment },
      policy,
    );

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        overallRating: nextRating,
        comment: nextComment,
        tags: dto.tags ?? review.tags,
        recommendAgain: dto.recommendAgain ?? review.recommendAgain,
        ...(authorType === 'INSTRUCTOR' && dto.confidentialNote !== undefined
          ? { confidentialNote: dto.confidentialNote }
          : {}),
        state: flags.length > 0 ? 'FLAGGED' : review.state,
        flagReason: flags.length > 0 ? flags.join(', ') : null,
      },
    });

    // An edit changes the numbers, so a published aggregate must be redone.
    if (updated.state === 'PUBLISHED') {
      await this.recomputeAggregate(updated.subjectType, updated.subjectId);
    }

    return { id: updated.id, state: updated.state, flagReasons: flags };
  }

  /**
   * Applies the double-blind rule to both reviews on a session and publishes
   * whichever qualify. Called after a submit and from the publishing cron.
   */
  async tryPublish(sessionId: string): Promise<{ published: boolean }> {
    const policy = this.settings.get('review');

    const session = await this.prisma.bookingSession.findFirst({
      where: { id: sessionId },
      select: {
        completedAt: true,
        reviews: {
          where: { deletedAt: null },
          select: {
            id: true,
            authorType: true,
            state: true,
            submittedAt: true,
            subjectType: true,
            subjectId: true,
            overallRating: true,
          },
        },
      },
    });

    if (!session?.completedAt) return { published: false };

    const now = new Date();
    let publishedAny = false;

    for (const review of session.reviews) {
      const counterparty =
        session.reviews.find((r) => r.authorType !== review.authorType) ?? null;

      const decision = decidePublishing(
        {
          own: { state: review.state, submittedAt: review.submittedAt },
          counterparty: counterparty
            ? { state: counterparty.state, submittedAt: counterparty.submittedAt }
            : null,
          sessionCompletedAt: session.completedAt,
          now,
        },
        policy,
      );

      if (!decision.publish) continue;

      await this.prisma.review.update({
        where: { id: review.id },
        data: { state: 'PUBLISHED', publishedAt: now },
      });

      await this.recomputeAggregate(review.subjectType, review.subjectId);

      if (review.subjectType === 'CUSTOMER') {
        await this.applyTrustEvent(
          review.subjectId,
          review.id,
          review.overallRating,
        );
      } else {
        await this.checkLowRatingAlert(review.subjectId);
      }

      publishedAny = true;

      this.logger.log(
        `Review ${review.id} published (${decision.reason})`,
      );
    }

    return { published: publishedAny };
  }

  /** Public reviews of a teacher, for the profile screen. */
  async publicReviewsOf(instructorId: string, limit = 20) {
    const [aggregate, reviews] = await Promise.all([
      this.prisma.ratingAggregate.findUnique({
        where: {
          subjectType_subjectId: {
            subjectType: 'INSTRUCTOR',
            subjectId: instructorId,
          },
        },
      }),
      this.prisma.review.findMany({
        where: {
          subjectType: 'INSTRUCTOR',
          subjectId: instructorId,
          state: 'PUBLISHED',
          deletedAt: null,
        },
        orderBy: { publishedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          overallRating: true,
          comment: true,
          tags: true,
          photos: true,
          recommendAgain: true,
          publishedAt: true,
          reply: true,
          repliedAt: true,
          criteriaScores: {
            select: {
              score: true,
              criteria: { select: { name: true, slug: true } },
            },
          },
        },
      }),
    ]);

    return {
      aggregate: aggregate ?? {
        ratingAvg: 0,
        ratingCount: 0,
        criteriaAverages: {},
        distribution: {},
      },
      reviews,
    };
  }

  /**
   * What a teacher may see about a customer before arriving (spec 4.3): the
   * trust band and advisory tags only — never the score, the comments or
   * another teacher's confidential note.
   */
  async customerAdvisoryFor(customerId: string) {
    const [profile, recent] = await Promise.all([
      this.prisma.customerProfile.findUnique({
        where: { id: customerId },
        select: { trustBand: true },
      }),
      this.prisma.review.findMany({
        where: {
          subjectType: 'CUSTOMER',
          subjectId: customerId,
          state: 'PUBLISHED',
          deletedAt: null,
        },
        orderBy: { publishedAt: 'desc' },
        take: 20,
        select: { tags: true },
      }),
    ]);

    const tagCounts = new Map<string, number>();
    for (const review of recent) {
      for (const tag of review.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return {
      trustBand: profile?.trustBand ?? 'NEW',
      advisoryTags: [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count })),
    };
  }

  /** The teacher's single permitted reply to a published review. */
  async reply(instructorId: string, reviewId: string, text: string) {
    const review = await this.prisma.review.findFirst({
      where: {
        id: reviewId,
        subjectType: 'INSTRUCTOR',
        subjectId: instructorId,
        state: 'PUBLISHED',
        deletedAt: null,
      },
      select: { id: true, reply: true },
    });

    if (!review) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Published review not found',
      });
    }

    if (review.reply) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: 'You have already replied to this review',
      });
    }

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { reply: text, repliedAt: new Date() },
      select: { id: true, reply: true, repliedAt: true },
    });
  }

  /** Either side reports a published review (spec 4.5). */
  async report(
    reporterType: 'CUSTOMER' | 'INSTRUCTOR',
    reporterId: string,
    reviewId: string,
    reason: string,
  ) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, deletedAt: null },
      select: { id: true, state: true, subjectId: true, subjectType: true },
    });

    if (!review) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Review not found',
      });
    }

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reviewReport.create({
        data: {
          reviewId,
          reportedBy: reporterType,
          reportedById: reporterId,
          reason,
        },
      });

      // Hidden pending moderation, and its contribution removed from the
      // aggregate immediately — a reported review should not keep affecting
      // someone's ranking while it is being looked at.
      await tx.review.update({
        where: { id: reviewId },
        data: { state: 'FLAGGED', flagReason: `Reported: ${reason}` },
      });

      return created;
    });

    await this.recomputeAggregate(review.subjectType, review.subjectId);

    return { reportId: report.id, state: 'FLAGGED' as const };
  }

  // --- moderation ----------------------------------------------------------

  /**
   * The review table (PDF 6.10 — "view customer reviews", "view associated
   * provider and booking information").
   *
   * **Both directions** — client instruction, 10 Nov 2026: the customer's
   * review of the provider, and the provider's internal review of the
   * customer. The second carries `confidentialNote`, which **the customer must
   * never see**; it is returned here because this route is admin-only
   * (`@AllowAudience('admin')` + `reviews:view`) and the client asked for it.
   * It must never be copied onto a customer-facing response.
   *
   * Author and subject are polymorphic ids (`authorId` is a CustomerProfile,
   * `subjectId` an InstructorProfile, per `direction`), so there is no Prisma
   * relation to include — the names are resolved in a second pass rather than
   * by joining, which is why this is not one query.
   */
  async listForAdmin(query: ListReviewsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ReviewWhereInput = {
      deletedAt: null,
      // The two admin screens are this filter. Without it the internal
      // instructor-to-customer review, and its confidential note, would
      // surface on the customer-review screen.
      ...(query.direction && { direction: query.direction }),
      ...(query.state && { state: query.state }),
      ...(query.rating && { overallRating: query.rating }),
      ...(query.q && {
        booking: { code: { contains: query.q, mode: 'insensitive' } },
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          authorType: true,
          authorId: true,
          subjectType: true,
          subjectId: true,
          direction: true,
          overallRating: true,
          // Admin-only. Never put this on a customer-facing response.
          confidentialNote: true,
          comment: true,
          tags: true,
          state: true,
          flagReason: true,
          hiddenReason: true,
          reply: true,
          publishedAt: true,
          createdAt: true,
          booking: { select: { id: true, code: true } },
          session: { select: { id: true, sessionDate: true } },
          reports: {
            where: { state: 'OPEN' },
            select: { id: true, reason: true },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    // Author and subject swap sides with the direction, so every id is looked
    // up in both tables rather than assuming which one it belongs to.
    const ids = rows.flatMap((r) => [r.authorId, r.subjectId]);
    const [customers, instructors] = await Promise.all([
      this.prisma.customerProfile.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }),
      this.prisma.instructorProfile.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }),
    ]);

    const customerById = new Map(customers.map((c) => [c.id, c.name]));
    const instructorById = new Map(instructors.map((i) => [i.id, i.name]));

    return {
      rows: rows.map((r) => {
        const customerId =
          r.direction === 'CUSTOMER_TO_INSTRUCTOR' ? r.authorId : r.subjectId;
        const instructorId =
          r.direction === 'CUSTOMER_TO_INSTRUCTOR' ? r.subjectId : r.authorId;
        return {
          ...r,
          customerName: customerById.get(customerId) ?? null,
          instructorName: instructorById.get(instructorId) ?? null,
        };
      }),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async moderationQueue() {
    return this.prisma.review.findMany({
      where: { state: 'FLAGGED', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        direction: true,
        overallRating: true,
        comment: true,
        confidentialNote: true,
        flagReason: true,
        createdAt: true,
        session: { select: { id: true, sessionDate: true } },
        booking: { select: { code: true } },
        reports: {
          where: { state: 'OPEN' },
          select: { id: true, reason: true, reportedBy: true },
        },
      },
    });
  }

  /** Approve a flagged review: it publishes if the blind rule allows. */
  async approve(adminUserId: string, reviewId: string, note?: string) {
    const review = await this.requireReview(reviewId);

    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id: reviewId },
        data: { state: 'SUBMITTED', flagReason: null },
      });

      await tx.reviewReport.updateMany({
        where: { reviewId, state: 'OPEN' },
        data: {
          state: 'REJECTED',
          decidedById: adminUserId,
          decidedAt: new Date(),
          decisionNote: note ?? 'Review approved',
        },
      });
    });

    const result = await this.tryPublish(review.sessionId);

    return { id: reviewId, approved: true, published: result.published };
  }

  /** Hide a review. Reason is mandatory and it leaves the aggregates. */
  async hide(adminUserId: string, reviewId: string, reason: string) {
    const review = await this.requireReview(reviewId);

    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id: reviewId },
        data: {
          state: 'HIDDEN',
          hiddenReason: reason,
          hiddenById: adminUserId,
        },
      });

      await tx.reviewReport.updateMany({
        where: { reviewId, state: 'OPEN' },
        data: {
          state: 'UPHELD',
          decidedById: adminUserId,
          decidedAt: new Date(),
          decisionNote: reason,
        },
      });
    });

    await this.recomputeAggregate(review.subjectType, review.subjectId);

    this.logger.warn(`Review ${reviewId} hidden by ${adminUserId}: ${reason}`);

    return { id: reviewId, state: 'HIDDEN' as const };
  }

  // --- aggregates and trust ------------------------------------------------

  /**
   * Recomputes from the published set. Full recompute, not incremental:
   * hiding a review must remove its contribution exactly.
   */
  async recomputeAggregate(
    subjectType: 'INSTRUCTOR' | 'CUSTOMER',
    subjectId: string,
    tx?: Tx,
  ) {
    const db = tx ?? this.prisma;

    const reviews = await db.review.findMany({
      where: { subjectType, subjectId, state: 'PUBLISHED', deletedAt: null },
      select: {
        overallRating: true,
        criteriaScores: {
          select: { score: true, criteria: { select: { slug: true } } },
        },
      },
    });

    const aggregate = computeAggregate(
      reviews.map((review) => ({
        overallRating: review.overallRating,
        criteriaScores: review.criteriaScores.map((score) => ({
          slug: score.criteria.slug,
          score: score.score,
        })),
      })),
    );

    await db.ratingAggregate.upsert({
      where: { subjectType_subjectId: { subjectType, subjectId } },
      create: {
        subjectType,
        subjectId,
        ratingAvg: aggregate.ratingAvg,
        ratingCount: aggregate.ratingCount,
        criteriaAverages: aggregate.criteriaAverages,
        distribution: aggregate.distribution,
        lastRecalcAt: new Date(),
      },
      update: {
        ratingAvg: aggregate.ratingAvg,
        ratingCount: aggregate.ratingCount,
        criteriaAverages: aggregate.criteriaAverages,
        distribution: aggregate.distribution,
        lastRecalcAt: new Date(),
      },
    });

    // The instructor row carries its own copy because the matching engine and
    // the teacher list read it on every request.
    if (subjectType === 'INSTRUCTOR') {
      await db.instructorProfile.update({
        where: { id: subjectId },
        data: {
          ratingAvg: aggregate.ratingAvg,
          ratingCount: aggregate.ratingCount,
        },
      });
    }

    return aggregate;
  }

  /** Moves the customer's trust score and records why (spec 4.6). */
  private async applyTrustEvent(
    customerId: string,
    reviewId: string,
    rating: number,
  ) {
    const delta = trustDeltaFor(rating);

    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.customerProfile.findUniqueOrThrow({
        where: { id: customerId },
        select: { trustScore: true },
      });

      const current = Number(profile.trustScore);
      // A customer with no history starts neutral, not at zero.
      const base = current === 0 ? NEUTRAL_TRUST_SCORE : current;
      const next = clampTrustScore(base + delta);

      const reviewCount = await tx.review.count({
        where: {
          subjectType: 'CUSTOMER',
          subjectId: customerId,
          state: 'PUBLISHED',
          deletedAt: null,
        },
      });

      const band = trustBandFor(next, reviewCount);

      await tx.customerProfile.update({
        where: { id: customerId },
        data: { trustScore: next, trustBand: band },
      });

      await tx.trustEvent.create({
        data: {
          customerId,
          sourceReviewId: reviewId,
          delta,
          reason: `Teacher review: ${rating} star${rating === 1 ? '' : 's'}`,
          resultingScore: next,
          resultingBand: band,
        },
      });
    });
  }

  /** Two sub-threshold ratings in 30 days raises an ops alert (spec 4.6). */
  private async checkLowRatingAlert(instructorId: string) {
    const policy = this.settings.get('review');

    const recent = await this.prisma.review.findMany({
      where: {
        subjectType: 'INSTRUCTOR',
        subjectId: instructorId,
        state: 'PUBLISHED',
        deletedAt: null,
        publishedAt: {
          gte: new Date(Date.now() - policy.lowRatingWindowDays * 86_400_000),
        },
      },
      select: { overallRating: true, publishedAt: true },
    });

    const alert = needsLowRatingAlert(
      recent.map((r) => ({
        rating: r.overallRating,
        at: r.publishedAt ?? new Date(),
      })),
      new Date(),
      policy,
    );

    if (alert) {
      // The notification module will turn this into an ops alert and the
      // counselling workflow; the warning is the hook for it.
      this.logger.warn(
        `LOW_RATING_ALERT instructor=${instructorId}: two ratings below ${policy.lowRatingThreshold} within ${policy.lowRatingWindowDays} days`,
      );
    }
  }

  private async requireReview(reviewId: string) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, deletedAt: null },
      select: {
        id: true,
        sessionId: true,
        subjectType: true,
        subjectId: true,
        state: true,
      },
    });

    if (!review) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Review not found',
      });
    }

    return review;
  }
}
