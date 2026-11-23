import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { RefundService } from '../payment/refund.service';
import { isCompletableByTrainer } from '../trainer-app/trainer-view';
import { SessionService } from './session.service';

/**
 * Page 32's two buttons — **Completed** and **Cancel** (client, 23-11-2026).
 * The trainer closes the booking himself from the detail screen instead of
 * walking the `EN_ROUTE` → check-in → check-out path, which stays on
 * `InstructorController` for the apps that still drive a session day.
 *
 * **Completion is OTP-based, geo-fence free** (client, 23-11-2026): the
 * customer reads the 4-digit code off their own app and the trainer types it
 * here. The code is proof that the two of them met, which is what the
 * geo-fence was for, so there is nothing left for it to add.
 */

/**
 * The completable set is `COMPLETABLE_STATUSES` in `trainer-view.ts`, next to
 * the bucket map the screen draws from, so the button's presence and the
 * route's guard can never disagree.
 *
 * `NO_SHOW_TEACHER` is in it on purpose. The auto no-show cron flags an
 * `ASSIGNED` or `EN_ROUTE` session whose check-in never happened
 * (`session-autocomplete.service.ts`) — and under this flow a check-in never
 * happens at all, so a trainer who taps Completed more than `noShowWaitMin`
 * after the end time would otherwise be locked out of his own session. A
 * valid customer code disproves the flag; the correction is written to
 * `booking_status_history` like every other transition. The cron raises no
 * refund when it flags, so nothing has to be unwound.
 */
@Injectable()
export class SessionActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly refunds: RefundService,
  ) {}

  /** The Completed button. Writes `COMPLETED` and the earning row. */
  async complete(instructorId: string, sessionId: string, otp: string) {
    const { checkInOtp, ...session } = await this.requireOwn(
      instructorId,
      sessionId,
    );

    if (!isCompletableByTrainer(session.status)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `A ${session.status} session cannot be completed`,
      });
    }

    if (!checkInOtp || checkInOtp !== otp) {
      throw new BadRequestException({
        code: ErrorCode.OTP_INVALID,
        message: 'Incorrect session code',
      });
    }

    return this.sessions.completeSession({
      session,
      instructorId,
      completedAt: new Date(),
      actorType: 'INSTRUCTOR',
      reason:
        session.status === 'NO_SHOW_TEACHER'
          ? 'Completed with the customer code after an automatic no-show flag'
          : 'Completed with the customer code',
    });
  }

  /**
   * The Cancel button. The reason decides the status: a client who was not
   * there is a `NO_SHOW_CUSTOMER` (charged per policy, no refund), anything
   * else is `CANCELLED_BY_TEACHER` (full refund plus goodwill, and the
   * trainer loses the earning). Both slabs come from settings — the
   * arithmetic is `RefundService`'s, including which statuses it will act on.
   */
  async cancel(
    instructorId: string,
    sessionId: string,
    input: { reason: string; clientAbsent?: boolean },
  ) {
    const session = await this.requireOwn(instructorId, sessionId);

    return this.refunds.cancelSession({
      sessionId: session.id,
      cancelledBy: input.clientAbsent ? 'CUSTOMER_NO_SHOW' : 'INSTRUCTOR',
      actorId: instructorId,
      actorType: 'INSTRUCTOR',
      reason: input.reason,
    });
  }

  /** The trainer may only close a session that is his own. */
  private async requireOwn(instructorId: string, sessionId: string) {
    const session = await this.prisma.bookingSession.findFirst({
      where: { id: sessionId, instructorId, deletedAt: null },
      select: {
        id: true,
        bookingId: true,
        status: true,
        serviceId: true,
        sessionValue: true,
        checkInOtp: true,
      },
    });

    if (!session) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Booking not found',
      });
    }

    return session;
  }
}
