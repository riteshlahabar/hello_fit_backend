import { Injectable } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';
import { NotificationContextService } from '../notification/notification-context.service';

/**
 * The booking half of PDF §3.9 / US-C14 — "notify the customer of relevant
 * booking events".
 *
 * Kept out of `BookingService` on purpose. That file is already long, and the
 * emit calls want the booking loaded a second time anyway (the code and the
 * first occurrence, formatted for a human); folding that into the create
 * transaction would mean a push decides whether a booking commits.
 *
 * Every method is fire-and-forget: `NotificationService.emit` catches its own
 * errors and only writes outbox rows, so a dead FCM cannot fail a payment.
 */
@Injectable()
export class BookingNotifications {
  constructor(
    private readonly notifications: NotificationService,
    private readonly context: NotificationContextService,
  ) {}

  /** Slot held, money not taken yet. The customer has minutes to pay. */
  async created(bookingId: string, holdMinutes: number) {
    const booking = await this.context.forBooking(bookingId);
    if (!booking) return;

    await this.notifications.emit('booking.created_payment_pending', {
      customer: { customerId: booking.customerId },
      data: {
        bookingCode: booking.bookingCode,
        payable: booking.payable,
        holdMinutes,
      },
    });
  }

  /**
   * Paid and confirmed. `invoiceNo` comes from the caller because only the
   * payment path holds it — the admin "mark paid" route raises no invoice.
   */
  async confirmed(bookingId: string, invoiceNo: string | null) {
    const booking = await this.context.forBooking(bookingId);
    if (!booking) return;

    await this.notifications.emit('booking.confirmed', {
      customer: { customerId: booking.customerId },
      admin: true,
      data: {
        bookingCode: booking.bookingCode,
        sessionDate: booking.sessionDate,
        fromTime: booking.fromTime,
        invoiceNo: invoiceNo ?? '',
      },
    });
  }

  /** Gateway refused, or the hold ran out and the slot went back. */
  async paymentFailed(bookingId: string, reason: string) {
    const booking = await this.context.forBooking(bookingId);
    if (!booking) return;

    await this.notifications.emit('booking.payment_failed', {
      customer: { customerId: booking.customerId },
      admin: true,
      data: { bookingCode: booking.bookingCode, reason },
    });
  }
}
