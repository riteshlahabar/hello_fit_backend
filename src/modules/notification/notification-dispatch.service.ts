import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationRepository } from './notification.repository';
import { pushPriority } from './events';
import { nextAttemptAt, shouldRetry } from './retry';
import {
  EMAIL_SENDER,
  PUSH_SENDER,
  SMS_SENDER,
  type EmailSender,
  type PushSender,
  type SendOutcome,
  type SmsSender,
} from './channels/channel.port';

/**
 * Delivers queued outbox rows.
 *
 * Every minute, because a session reminder or an offer countdown is only useful
 * promptly — this is the one cron here where the interval is about user-visible
 * latency rather than housekeeping. Sub-minute precision is what BullMQ would
 * buy, and the offer timer is 10 minutes, so a minute is comfortably enough.
 *
 * A row is claimed by moving it out of `QUEUED` before the send, so a slow
 * provider cannot have the next tick send the same notification twice.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  /** Per-tick cap. Keeps one backlog from monopolising the process. */
  private static readonly BATCH = 100;

  private running = false;

  constructor(
    private readonly repo: NotificationRepository,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous dispatch is still running; skipping this tick');
      return;
    }
    this.running = true;

    try {
      const due = await this.repo.findDue(
        NotificationDispatchService.BATCH,
        new Date(),
      );
      if (due.length === 0) return;

      let sent = 0;
      let failed = 0;

      for (const row of due) {
        try {
          const ok = await this.deliver(row);
          if (ok) sent += 1;
          else failed += 1;
        } catch (error) {
          failed += 1;
          // One poisoned row must not stop the batch.
          await this.recordFailure(
            row.id,
            row.attempts,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      this.logger.log(
        `Dispatched ${due.length} notification(s): ${sent} sent, ${failed} failed`,
      );
    } catch (error) {
      this.logger.error(
        'Notification dispatch failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  private async deliver(
    row: Awaited<ReturnType<NotificationRepository['findDue']>>[number],
  ): Promise<boolean> {
    switch (row.channel) {
      case 'PUSH':
        return this.deliverPush(row);
      case 'SMS':
        return this.deliverSimple(
          row.id,
          row.attempts,
          row.destination,
          () => this.sms.send(row.destination!, row.body),
          'no mobile number on the account',
        );
      case 'EMAIL':
        return this.deliverSimple(
          row.id,
          row.attempts,
          row.destination,
          () =>
            this.email.send(row.destination!, {
              subject: row.title ?? 'HelloFit',
              body: row.body,
            }),
          'no email address on the account',
        );
      case 'IN_APP':
        // In-app rows are written directly by `emit` and never queued. One
        // here means a bug upstream, so it is closed out rather than retried.
        await this.repo.markOutbox(row.id, {
          status: 'SUPPRESSED',
          suppressedReason: 'IN_APP is written directly, not dispatched',
        });
        return true;
      default:
        await this.repo.markOutbox(row.id, {
          status: 'FAILED',
          lastError: `Unknown channel ${String(row.channel)}`,
        });
        return false;
    }
  }

  /**
   * Push fans out to every live device. Partial success counts as sent — a
   * customer with a dead tablet token and a live phone got the message — and
   * each permanently dead token is cleared so it is never tried again.
   */
  private async deliverPush(
    row: Awaited<ReturnType<NotificationRepository['findDue']>>[number],
  ): Promise<boolean> {
    // An admin recipient has no `User` row and therefore no devices at all:
    // the spec's admin "push" means web push from the admin panel, which needs
    // its own device registration and does not exist yet. Suppressed with a
    // reason that says so, rather than retried four times against nothing.
    if (row.adminUserId) {
      await this.repo.markOutbox(row.id, {
        status: 'SUPPRESSED',
        suppressedReason:
          'Admin web push is not implemented — the in-app row carries this event',
      });
      return true;
    }

    const devices = (row.user?.devices ?? []).filter((d) => d.fcmToken);

    if (devices.length === 0) {
      // Not a failure worth retrying: there is no device to send to until the
      // app registers one, and by then this notification is stale.
      await this.repo.markOutbox(row.id, {
        status: 'SUPPRESSED',
        suppressedReason: 'No registered device token',
      });
      return true;
    }

    const attempts = row.attempts + 1;
    const outcomes = await this.push.sendToTokens(
      devices.map((d) => d.fcmToken!),
      {
        title: row.title ?? 'HelloFit',
        body: row.body,
        deepLink: row.deepLink ?? undefined,
        priority: pushPriority(row.eventKey),
        data: { eventKey: row.eventKey },
      },
    );

    // Prune dead tokens regardless of the overall result.
    const dead = outcomes
      .map((outcome, index) => (outcome.permanentFailure ? devices[index] : null))
      .filter((device): device is (typeof devices)[number] => device !== null);

    await Promise.all(
      dead.map((device) =>
        this.repo.clearFcmToken(device.id).catch(() => undefined),
      ),
    );

    const delivered = outcomes.filter((o) => o.ok);
    if (delivered.length > 0) {
      await this.repo.markOutbox(row.id, {
        status: 'SENT',
        attempts,
        sentAt: new Date(),
        providerMessageId: delivered[0].messageId ?? null,
        lastError: null,
      });
      return true;
    }

    // Every token failed. If they all failed *permanently*, there is nothing
    // left to retry against — retrying would just re-send to nothing.
    const allPermanent = outcomes.every((o) => o.permanentFailure);
    const error = outcomes.map((o) => o.error).filter(Boolean).join('; ');

    if (allPermanent) {
      await this.repo.markOutbox(row.id, {
        status: 'FAILED',
        attempts,
        lastError: `every device token is dead: ${error}`.slice(0, 1000),
      });
      return false;
    }

    await this.recordFailure(row.id, row.attempts, error);
    return false;
  }

  /** SMS and email: one destination, one outcome. */
  private async deliverSimple(
    id: string,
    attempts: number,
    destination: string | null,
    send: () => Promise<SendOutcome>,
    missingDestinationReason: string,
  ): Promise<boolean> {
    if (!destination) {
      await this.repo.markOutbox(id, {
        status: 'SUPPRESSED',
        suppressedReason: missingDestinationReason,
      });
      return true;
    }

    const outcome = await send();

    if (outcome.ok) {
      await this.repo.markOutbox(id, {
        status: 'SENT',
        attempts: attempts + 1,
        sentAt: new Date(),
        providerMessageId: outcome.messageId ?? null,
        lastError: null,
      });
      return true;
    }

    if (outcome.permanentFailure) {
      await this.repo.markOutbox(id, {
        status: 'FAILED',
        attempts: attempts + 1,
        lastError: outcome.error?.slice(0, 1000) ?? 'permanent failure',
      });
      return false;
    }

    await this.recordFailure(id, attempts, outcome.error ?? 'unknown error');
    return false;
  }

  /**
   * Schedules a retry, or gives up once the cap is reached. A failed row stays
   * visible in the admin outbox with its last error rather than disappearing.
   */
  private async recordFailure(
    id: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const next = attempts + 1;

    if (shouldRetry(next)) {
      await this.repo.markOutbox(id, {
        status: 'QUEUED',
        attempts: next,
        nextAttemptAt: nextAttemptAt(next),
        lastError: error.slice(0, 1000),
      });
      return;
    }

    await this.repo.markOutbox(id, {
      status: 'FAILED',
      attempts: next,
      lastError: error.slice(0, 1000),
    });
  }
}
