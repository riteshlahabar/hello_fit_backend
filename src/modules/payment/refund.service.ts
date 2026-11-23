import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { sessionStartsAt } from '../../common/dates/calendar';
import { WalletService } from '../wallet/wallet.service';
import {
  computeRefund,
  isCancellable,
  type CancelledBy,
} from '../booking/refund.calculator';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly wallet: WalletService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Cancels one session and raises the refund the policy slab produces
   * (spec 3.5). Refund to wallet is instant; refund to source goes out
   * through the gateway and settles in 5 to 7 working days.
   */
  async cancelSession(params: {
    sessionId: string;
    cancelledBy: CancelledBy;
    actorId: string;
    actorType: 'CUSTOMER' | 'INSTRUCTOR' | 'ADMIN' | 'SYSTEM';
    reason: string;
    /** Customer preference; wallet is the default per spec 3.5. */
    mode?: 'WALLET' | 'SOURCE';
  }) {
    const slabs = this.settings.get('refundSlabs');

    const session = await this.prisma.bookingSession.findFirst({
      where: { id: params.sessionId, deletedAt: null },
      include: {
        checkIn: { select: { id: true } },
        booking: {
          select: {
            id: true,
            code: true,
            customerId: true,
            paymentStatus: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
    }

    if (!isCancellable(session.status)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `A ${session.status} session cannot be cancelled`,
      });
    }

    const startsAt = sessionStartsAt(session.sessionDate, session.fromMinute);

    const outcome = computeRefund(
      {
        sessionValue: Number(session.sessionValue),
        startsAt,
        now: new Date(),
        cancelledBy: params.cancelledBy,
        hasCheckedIn: Boolean(session.checkIn),
      },
      slabs,
    );

    const toStatus = statusFor(params.cancelledBy);

    // Nothing was paid yet, so there is nothing to refund — the slot just
    // goes back.
    const unpaid = session.booking.paymentStatus !== 'PAID';
    const refundable = !unpaid && outcome.amount > 0;
    const mode = params.mode ?? outcome.mode;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.bookingSession.update({
        where: { id: session.id },
        data: { status: toStatus, cancelReason: params.reason },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: session.booking.id,
          sessionId: session.id,
          fromStatus: session.status,
          toStatus,
          actorType: params.actorType,
          actorId: params.actorType === 'SYSTEM' ? null : params.actorId,
          reason: params.reason,
          remark: `Slab ${outcome.slab} → ${outcome.percent}% (${outcome.amount})`,
        },
      });

      // Any pending offer for a cancelled session is moot.
      await tx.assignment.updateMany({
        where: { sessionId: session.id, response: 'PENDING' },
        data: { response: 'CANCELLED', respondedAt: new Date() },
      });

      // A teacher who cancels or no-shows loses the earning for it.
      if (
        params.cancelledBy === 'INSTRUCTOR' ||
        params.cancelledBy === 'INSTRUCTOR_NO_SHOW'
      ) {
        await tx.earning.updateMany({
          where: { sessionId: session.id, status: { in: ['PENDING', 'PAYABLE'] } },
          data: {
            status: 'WITHHELD',
            withheldReason: `Session ${toStatus.toLowerCase()}`,
          },
        });
      }

      if (!refundable) {
        return { refund: null, walletEntry: null };
      }

      const refund = await tx.refund.create({
        data: {
          bookingId: session.booking.id,
          sessionId: session.id,
          slabApplied: outcome.slab,
          amount: outcome.amount,
          mode,
          // Wallet credits complete immediately; a card refund waits on the
          // gateway and is marked PROCESSING below.
          status: mode === 'WALLET' ? 'COMPLETED' : 'PENDING',
          ...(mode === 'WALLET' ? { processedAt: new Date() } : {}),
        },
      });

      let walletEntry = null;

      if (mode === 'WALLET') {
        walletEntry = await this.wallet.credit(
          {
            customerId: session.booking.customerId,
            amount: outcome.amount,
            source: 'REFUND',
            referenceType: 'refund',
            referenceId: refund.id,
            reason: `Refund for ${session.booking.code} (${outcome.slab})`,
          },
          tx,
        );
      }

      // Goodwill for provider-fault cancellations, on top of the refund.
      if (outcome.goodwillCredit > 0) {
        await this.wallet.credit(
          {
            customerId: session.booking.customerId,
            amount: outcome.goodwillCredit,
            source: 'GOODWILL',
            referenceType: 'session',
            referenceId: session.id,
            reason: 'Goodwill credit for a cancelled session',
          },
          tx,
        );
      }

      return { refund, walletEntry };
    });

    // Gateway call sits outside the transaction: a slow provider must not
    // hold a database transaction open, and the refund row already records
    // the intent so a failure is recoverable.
    if (result.refund && mode === 'SOURCE') {
      await this.sendToGateway(result.refund.id, session.booking.id, outcome.amount);
    }

    this.logger.log(
      `Session ${session.id} → ${toStatus}; refund ${outcome.amount} (${outcome.slab}, ${mode})`,
    );

    return {
      sessionId: session.id,
      status: toStatus,
      refund: {
        slab: outcome.slab,
        percent: outcome.percent,
        amount: unpaid ? 0 : outcome.amount,
        goodwillCredit: outcome.goodwillCredit,
        mode,
        applied: Boolean(result.refund),
      },
      walletBalance: result.walletEntry?.runningBalance ?? null,
    };
  }

  /**
   * What a cancellation would cost, without doing it — the app shows this
   * before the customer confirms (spec 6.2, Bookings tab).
   */
  async previewCancellation(customerId: string, sessionId: string) {
    const slabs = this.settings.get('refundSlabs');

    const session = await this.prisma.bookingSession.findFirst({
      where: {
        id: sessionId,
        deletedAt: null,
        booking: { customerId },
      },
      include: {
        checkIn: { select: { id: true } },
        booking: { select: { paymentStatus: true } },
      },
    });

    if (!session) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
    }

    const outcome = computeRefund(
      {
        sessionValue: Number(session.sessionValue),
        startsAt: sessionStartsAt(session.sessionDate, session.fromMinute),
        now: new Date(),
        cancelledBy: 'CUSTOMER',
        hasCheckedIn: Boolean(session.checkIn),
      },
      slabs,
    );

    return {
      sessionId,
      sessionValue: Number(session.sessionValue),
      cancellable: isCancellable(session.status),
      slab: outcome.slab,
      refundPercent: outcome.percent,
      refundAmount:
        session.booking.paymentStatus === 'PAID' ? outcome.amount : 0,
      mode: outcome.mode,
    };
  }

  private async sendToGateway(
    refundId: string,
    bookingId: string,
    amount: number,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { bookingId, status: 'CAPTURED', gatewayPaymentId: { not: null } },
      orderBy: { paidAt: 'desc' },
      select: { gatewayPaymentId: true },
    });

    if (!payment?.gatewayPaymentId) {
      await this.prisma.refund.update({
        where: { id: refundId },
        data: {
          status: 'FAILED',
          overrideReason:
            'No captured gateway payment found to refund against. Needs manual handling.',
        },
      });

      this.logger.error(
        `Refund ${refundId}: no gateway payment to refund against`,
      );
      return;
    }

    try {
      const sent = await this.gateway.refund({
        paymentId: payment.gatewayPaymentId,
        amount,
        notes: { refundId },
      });

      await this.prisma.refund.update({
        where: { id: refundId },
        data: {
          gatewayRefundId: sent.refundId,
          status: sent.status === 'PROCESSED' ? 'COMPLETED' : 'PROCESSING',
          ...(sent.status === 'PROCESSED' ? { processedAt: new Date() } : {}),
        },
      });
    } catch (error) {
      await this.prisma.refund.update({
        where: { id: refundId },
        data: {
          status: 'FAILED',
          overrideReason:
            error instanceof Error ? error.message : 'Gateway refund failed',
        },
      });

      this.logger.error(
        `Refund ${refundId} failed at the gateway`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

const statusFor = (by: CancelledBy) => {
  switch (by) {
    case 'CUSTOMER':
      return 'CANCELLED_BY_CUSTOMER' as const;
    case 'INSTRUCTOR':
      return 'CANCELLED_BY_TEACHER' as const;
    case 'ADMIN':
      return 'CANCELLED_BY_ADMIN' as const;
    case 'CUSTOMER_NO_SHOW':
      return 'NO_SHOW_CUSTOMER' as const;
    case 'INSTRUCTOR_NO_SHOW':
      return 'NO_SHOW_TEACHER' as const;
  }
};


