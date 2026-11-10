import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationService } from '../notification/notification.service';
import {
  addCalendarDays,
  calendarDaysBetween,
  todayCalendar,
} from '../../common/dates/calendar';

/**
 * Warns a teacher before a KYC document expires, and marks it `EXPIRED` once it
 * has (spec 8.1).
 *
 * This was deliberately left unbuilt when onboarding shipped: a cron that can
 * only write a log line is half a feature, because the point is to *warn*
 * someone. It became worth building the moment the notification port existed.
 *
 * Why it matters: an expired police verification makes a teacher ineligible for
 * work (`isEligibleForWork` checks it), so without a reminder a long-serving
 * teacher silently stops receiving offers and nobody knows why.
 *
 * Daily, because the window is measured in days and a reminder sent at 03:00 or
 * 15:00 reads identically.
 */
@Injectable()
export class DocumentExpiryService {
  private readonly logger = new Logger(DocumentExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async run(): Promise<void> {
    try {
      await this.warnExpiring();
      await this.markExpired();
    } catch (error) {
      this.logger.error(
        'Document expiry sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * One reminder per document, on the day it enters the warning window.
   *
   * Scoped to exactly that day rather than "anything expiring within N days",
   * because the latter re-sends every morning until the teacher acts — which
   * trains them to ignore it. A single, well-timed message is the whole design.
   */
  private async warnExpiring(): Promise<void> {
    const { expiryReminderDays } = this.settings.get('onboarding');
    const target = addCalendarDays(todayCalendar(), expiryReminderDays);

    const documents = await this.prisma.document.findMany({
      where: {
        ownerType: 'INSTRUCTOR',
        verifyStatus: 'VERIFIED',
        deletedAt: null,
        expiryDate: target,
      },
      select: { id: true, ownerId: true, docType: true, expiryDate: true },
    });

    for (const doc of documents) {
      await this.notifications.emit('document.expiring', {
        instructor: { instructorId: doc.ownerId },
        admin: true,
        data: {
          docType: String(doc.docType),
          expiryDate: doc.expiryDate,
          daysLeft: expiryReminderDays,
        },
      });
    }

    if (documents.length > 0) {
      this.logger.log(
        `Warned ${documents.length} teacher(s) about documents expiring in ${expiryReminderDays} days`,
      );
    }
  }

  /**
   * Flips a lapsed document to `EXPIRED`.
   *
   * `kycStatus` on the profile is **not** recomputed here. It is derived from
   * the document set by `deriveKycStatus`, which already treats an expired
   * document as unverified — so the flag follows on the next read rather than
   * being written twice from two places and risking disagreement.
   */
  private async markExpired(): Promise<void> {
    const today = todayCalendar();

    const result = await this.prisma.document.updateMany({
      where: {
        ownerType: 'INSTRUCTOR',
        verifyStatus: 'VERIFIED',
        deletedAt: null,
        expiryDate: { lt: today },
      },
      data: { verifyStatus: 'EXPIRED' },
    });

    if (result.count > 0) {
      this.logger.warn(
        `${result.count} instructor document(s) passed their expiry date and are now EXPIRED`,
      );
    }
  }

  /** Days until a document expires. Exposed for the admin detail screen. */
  daysUntilExpiry(expiryDate: Date): number {
    return calendarDaysBetween(todayCalendar(), expiryDate);
  }
}
