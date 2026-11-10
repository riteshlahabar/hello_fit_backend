import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type {
  NotificationAudience,
  NotificationChannel,
  NotificationStatus,
} from '../../generated/prisma/enums';

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------- templates

  /**
   * Best template for the event: the requested locale, falling back to `en`.
   * A missing template is not an error — the service falls back to the event's
   * built-in default copy, so a new event still notifies before ops writes any.
   */
  findTemplate(input: {
    eventKey: string;
    channel: NotificationChannel;
    audience: NotificationAudience;
    locale: string;
  }) {
    return this.prisma.notificationTemplate.findFirst({
      where: {
        eventKey: input.eventKey,
        channel: input.channel,
        audience: input.audience,
        locale: { in: [input.locale, 'en'] },
        isActive: true,
        deletedAt: null,
      },
      // Exact locale first: 'en' sorts before most tags, so order by whether
      // it matches rather than alphabetically.
      orderBy: { locale: input.locale === 'en' ? 'asc' : 'desc' },
    });
  }

  listTemplates(filter: { eventKey?: string; channel?: NotificationChannel }) {
    return this.prisma.notificationTemplate.findMany({
      where: {
        deletedAt: null,
        ...(filter.eventKey && { eventKey: filter.eventKey }),
        ...(filter.channel && { channel: filter.channel }),
      },
      orderBy: [{ eventKey: 'asc' }, { audience: 'asc' }, { channel: 'asc' }],
    });
  }

  findTemplateById(id: string) {
    return this.prisma.notificationTemplate.findFirst({
      where: { id, deletedAt: null },
    });
  }

  upsertTemplate(data: Prisma.NotificationTemplateUncheckedCreateInput) {
    return this.prisma.notificationTemplate.upsert({
      where: {
        eventKey_channel_audience_locale: {
          eventKey: data.eventKey,
          channel: data.channel,
          audience: data.audience,
          locale: data.locale ?? 'en',
        },
      },
      create: data,
      update: {
        title: data.title,
        body: data.body,
        deepLink: data.deepLink,
        providerRef: data.providerRef,
        isActive: data.isActive ?? true,
        deletedAt: null,
      },
    });
  }

  softDeleteTemplate(id: string) {
    return this.prisma.notificationTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // ------------------------------------------------------------------ outbox

  /**
   * Enqueues many rows at once. `createMany` rather than a loop because an
   * event fanning out to three audiences on four channels is a dozen rows and
   * this sits on the request path of a booking.
   */
  enqueue(rows: Prisma.NotificationOutboxUncheckedCreateInput[]) {
    return this.prisma.notificationOutbox.createMany({ data: rows });
  }

  /** Everything due, oldest first. The dispatch cron's only query. */
  findDue(limit: number, now: Date) {
    return this.prisma.notificationOutbox.findMany({
      where: { status: 'QUEUED', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            mobile: true,
            email: true,
            language: true,
            devices: {
              where: { revokedAt: null, fcmToken: { not: null } },
              select: { id: true, fcmToken: true },
            },
          },
        },
      },
    });
  }

  markOutbox(
    id: string,
    data: {
      status: NotificationStatus;
      attempts?: number;
      nextAttemptAt?: Date;
      sentAt?: Date;
      providerMessageId?: string | null;
      lastError?: string | null;
      suppressedReason?: string | null;
    },
  ) {
    return this.prisma.notificationOutbox.update({ where: { id }, data });
  }

  async listOutbox(filter: {
    status?: NotificationStatus;
    channel?: NotificationChannel;
    eventKey?: string;
    userId?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.NotificationOutboxWhereInput = {
      ...(filter.status && { status: filter.status }),
      ...(filter.channel && { channel: filter.channel }),
      ...(filter.eventKey && { eventKey: filter.eventKey }),
      ...(filter.userId && { userId: filter.userId }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notificationOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.notificationOutbox.count({ where }),
    ]);
    return { rows, total };
  }

  /** Puts a failed row back in the queue, for the admin retry button. */
  requeue(id: string) {
    return this.prisma.notificationOutbox.update({
      where: { id },
      data: {
        status: 'QUEUED',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
  }

  // ---------------------------------------------------------------- in-app

  createInApp(rows: Prisma.InAppNotificationUncheckedCreateInput[]) {
    return this.prisma.inAppNotification.createMany({ data: rows });
  }

  async listInApp(userId: string, unreadOnly: boolean, skip: number, take: number) {
    const where: Prisma.InAppNotificationWhereInput = {
      userId,
      deletedAt: null,
      ...(unreadOnly && { readAt: null }),
    };

    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.inAppNotification.count({ where }),
      this.prisma.inAppNotification.count({
        where: { userId, deletedAt: null, readAt: null },
      }),
    ]);
    return { rows, total, unread };
  }

  countUnread(userId: string) {
    return this.prisma.inAppNotification.count({
      where: { userId, deletedAt: null, readAt: null },
    });
  }

  /** Scoped by `userId` so one user cannot mark another's notification read. */
  markRead(userId: string, id: string) {
    return this.prisma.inAppNotification.updateMany({
      where: { id, userId, deletedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** The admin panel bell. Scoped by `adminUserId`, never by `userId`. */
  async listInAppForAdmin(
    adminUserId: string,
    unreadOnly: boolean,
    skip: number,
    take: number,
  ) {
    const where = {
      adminUserId,
      deletedAt: null,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: "desc" as const },
        skip,
        take,
      }),
      this.prisma.inAppNotification.count({ where }),
      this.prisma.inAppNotification.count({
        where: { adminUserId, deletedAt: null, readAt: null },
      }),
    ]);
    return { rows, total, unread };
  }

  markReadForAdmin(adminUserId: string, id: string) {
    return this.prisma.inAppNotification.updateMany({
      where: { id, adminUserId, deletedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
  }

  markAllRead(userId: string) {
    return this.prisma.inAppNotification.updateMany({
      where: { userId, deletedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ------------------------------------------------------------ preferences

  listPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  /** `eventKey` of `*` means every event on the channel. */
  setPreference(input: {
    userId: string;
    channel: NotificationChannel;
    eventKey: string;
    enabled: boolean;
  }) {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_channel_eventKey: {
          userId: input.userId,
          channel: input.channel,
          eventKey: input.eventKey,
        },
      },
      create: input,
      update: { enabled: input.enabled },
    });
  }

  /** The opt-outs that apply to one user, read once per dispatch batch. */
  findDisabled(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId, enabled: false },
      select: { channel: true, eventKey: true },
    });
  }

  // ---------------------------------------------------------------- devices

  /**
   * Deletes a device token FCM reported as permanently dead. The row stays —
   * it is the device record — only the token goes, so the next app launch can
   * register a fresh one against the same `(userId, deviceId)`.
   */
  clearFcmToken(deviceId: string) {
    return this.prisma.device.update({
      where: { id: deviceId },
      data: { fcmToken: null },
    });
  }

  /**
   * Admin recipients for an `ADMIN`-audience event.
   *
   * Queries `adminUser`, **not** `user`: there is no `UserRole.ADMIN` and
   * `AdminUser` is a standalone table. An earlier version of this filtered
   * `user.roles has 'ADMIN'`, which Prisma rejected at runtime and took the
   * whole document-rejection request down with it.
   */
  findAdminRecipients() {
    return this.prisma.adminUser.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true, email: true, mobile: true },
    });
  }

  findUserForNotify(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, mobile: true, email: true, language: true },
    });
  }

  /** Resolves an instructor or customer profile id to the user behind it. */
  findUserIdByInstructorId(instructorId: string) {
    return this.prisma.instructorProfile.findFirst({
      where: { id: instructorId, deletedAt: null },
      select: { userId: true },
    });
  }

  findUserIdByCustomerId(customerId: string) {
    return this.prisma.customerProfile.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { userId: true },
    });
  }
}
