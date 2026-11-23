import { Injectable } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';
import { NotificationContextService } from '../notification/notification-context.service';

/**
 * PDF §3.9: "provide status updates when a provider accepts or rejects a
 * request" — the customer half of §4.7, plus the teacher's own offer card.
 *
 * The asymmetry here is deliberate. A `DIRECT` rejection is told to the
 * customer because they chose that provider and must choose again; an `AUTO`
 * decline is not, because the cascade simply asks the next teacher and the
 * customer never knew the first one existed.
 */
@Injectable()
export class AssignmentNotifications {
  constructor(
    private readonly notifications: NotificationService,
    private readonly context: NotificationContextService,
  ) {}

  /** A ranked offer waiting on one teacher, with its countdown. */
  async offered(sessionId: string, instructorId: string, expiresAt: Date | null) {
    const ctx = await this.context.forSession(sessionId);
    if (!ctx) return;

    // A whole sentence rather than a number, because a direct request has no
    // countdown at all: `offerDirect` sets no `expiresAt`, and "respond within
    // 0 minutes" is worse than saying nothing about time.
    const expiresInMin = expiresAt
      ? Math.max(Math.round((expiresAt.getTime() - Date.now()) / 60_000), 0)
      : 0;
    const respondBy = expiresAt
      ? `Respond within ${expiresInMin} minutes.`
      : 'The customer asked for you by name — accept or decline.';

    await this.notifications.emit('offer.created', {
      instructor: { instructorId },
      data: {
        areaName: ctx.areaName,
        sessionDate: ctx.sessionDate,
        fromTime: ctx.fromTime,
        toTime: ctx.toTime,
        respondBy,
      },
    });
  }

  /**
   * A teacher is on the session: accepted an offer, accepted the customer's
   * direct request, or was placed there by ops. All three are the same news
   * to the customer, so they are one event.
   */
  async confirmed(sessionId: string) {
    const ctx = await this.context.forSession(sessionId);
    if (!ctx?.instructorId) return;

    await this.notifications.emit('assignment.confirmed', {
      customer: { customerId: ctx.customerId },
      instructor: { instructorId: ctx.instructorId },
      admin: true,
      data: {
        instructorName: ctx.instructorName ?? '',
        sessionDate: ctx.sessionDate,
        fromTime: ctx.fromTime,
      },
    });
  }

  /**
   * The chosen provider said no. Called from `releaseDirect`, which has
   * already detached them — so the name is passed in rather than read back
   * off a session that no longer has one.
   */
  async requestRejected(sessionId: string, instructorName: string) {
    const ctx = await this.context.forSession(sessionId);
    if (!ctx) return;

    await this.notifications.emit('assignment.request_rejected', {
      customer: { customerId: ctx.customerId },
      admin: true,
      data: {
        bookingCode: ctx.bookingCode,
        instructorName,
        sessionDate: ctx.sessionDate,
        fromTime: ctx.fromTime,
      },
    });
  }

  /** Nobody accepted. Admin-only by the matrix — ops assigns by hand. */
  async cascadeExhausted(sessionId: string, attempts: number) {
    const ctx = await this.context.forSession(sessionId);
    if (!ctx) return;

    await this.notifications.emit('assignment.cascade_exhausted', {
      admin: true,
      data: {
        bookingCode: ctx.bookingCode,
        sessionDate: ctx.sessionDate,
        fromTime: ctx.fromTime,
        attempts,
      },
    });
  }
}
