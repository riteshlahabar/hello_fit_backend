import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingNotifications } from './booking.notifications';

/**
 * Releases slots held by bookings that were never paid for (spec 3.1 step 10:
 * "auto-expires in 15 minutes, releasing the held slot").
 *
 * The hold lives in Postgres rather than Redis, so a restart cannot lose it
 * and the expiry is auditable — each released session gets a status-history
 * row like any other transition. When BullMQ arrives this becomes a delayed
 * job per booking; the cron stays as the safety net.
 */
@Injectable()
export class BookingExpiryService {
  private readonly logger = new Logger(BookingExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: BookingNotifications,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireUnpaidBookings(): Promise<void> {
    const now = new Date();

    const expired = await this.prisma.booking.findMany({
      where: {
        paymentStatus: 'UNPAID',
        holdExpiresAt: { lt: now },
        deletedAt: null,
        sessions: { some: { status: 'PENDING_PAYMENT' } },
      },
      select: { id: true, code: true, sessions: { select: { id: true } } },
      take: 200,
    });

    if (expired.length === 0) return;

    for (const booking of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.bookingSession.updateMany({
          where: { bookingId: booking.id, status: 'PENDING_PAYMENT' },
          data: {
            status: 'CANCELLED_BY_ADMIN',
            cancelReason: 'Payment not completed within the hold window',
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: 'FAILED',
            cancelReason: 'Payment not completed within the hold window',
            holdExpiresAt: null,
          },
        });

        await tx.bookingStatusHistory.createMany({
          data: booking.sessions.map((session) => ({
            bookingId: booking.id,
            sessionId: session.id,
            fromStatus: 'PENDING_PAYMENT' as const,
            toStatus: 'CANCELLED_BY_ADMIN' as const,
            actorType: 'SYSTEM' as const,
            reason: 'Hold expired before payment',
          })),
        });
      });
    }

    // Sent after the slot is actually back, so the customer is told why the
    // booking they left half-paid has gone (PDF 3.9, payment messages).
    for (const booking of expired) {
      await this.notifier.paymentFailed(
        booking.id,
        'Payment was not completed within the hold window.',
      );
    }

    this.logger.log(
      `Released ${expired.length} unpaid booking(s): ${expired
        .map((b) => b.code)
        .join(', ')}`,
    );
  }
}
