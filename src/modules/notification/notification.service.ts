import { Injectable, Logger } from '@nestjs/common';
import { NotificationRepository } from './notification.repository';
import { render } from './render';
import {
  ALL_EVENTS_SENTINEL,
  channelsFor,
  eventDefinition,
  isSuppressible,
  type NotificationEventKey,
} from './events';
import { DEFAULT_COPY } from './default-copy';
import type {
  NotificationAudience,
  NotificationChannel,
} from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';

/** Who should hear about an event. At least one field must be set. */
export interface EmitTarget {
  /** `User.id` directly. */
  userId?: string;
  /** Resolved to its user. Convenient at call sites that hold a profile id. */
  customerId?: string;
  instructorId?: string;
}

export interface EmitInput {
  /** Values for the template placeholders. */
  data?: Record<string, unknown>;
  /** Overrides the deep link from the template. */
  deepLink?: string;
  /** Who hears it, per audience. Omit an audience to skip it entirely. */
  customer?: EmitTarget;
  instructor?: EmitTarget;
  /** `true` fans out to every active admin; the matrix decides the channels. */
  admin?: boolean;
}

/**
 * The one entry point domain code uses: `notifications.emit(key, input)`.
 *
 * **Emit never throws and never blocks the caller's transaction.** A booking
 * must not fail because FCM is down, so `emit` only writes outbox rows — the
 * dispatch cron does the sending. That is the same Postgres-deadline pattern
 * every other timed behaviour here uses in place of BullMQ: it survives a
 * restart, and the admin outbox screen shows exactly what was sent and what
 * failed.
 *
 * Copy is rendered **at enqueue time**, not at send time: what a customer
 * received must not change because ops edited the template five minutes later.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly repo: NotificationRepository) {}

  // `string & {}` keeps autocomplete for the known keys while still accepting
  // any string, without the union collapsing to `string`.
  async emit(
    eventKey: NotificationEventKey | (string & {}),
    input: EmitInput = {},
  ) {
    const def = eventDefinition(eventKey);
    if (!def) {
      // A typo in an event key is a programming error, but it must not take a
      // booking down with it. Loud log, no throw.
      this.logger.error(`emit() called with unknown event key: ${eventKey}`);
      return { queued: 0, inApp: 0 };
    }

    const outbox: Prisma.NotificationOutboxUncheckedCreateInput[] = [];
    const inApp: Prisma.InAppNotificationUncheckedCreateInput[] = [];

    const audiences: Array<[NotificationAudience, EmitTarget | undefined]> = [
      ['CUSTOMER', input.customer],
      ['INSTRUCTOR', input.instructor],
      ['ADMIN', input.admin ? {} : undefined],
    ];

    for (const [audience, target] of audiences) {
      if (!target) continue;

      const channels = channelsFor(eventKey, audience);
      if (channels.length === 0) continue;

      // Admins are AdminUser rows with no User and no devices, so they are
      // enqueued against `adminUserId` and get a different recipient shape.
      const recipients =
        audience === 'ADMIN'
          ? (await this.repo.findAdminRecipients()).map((a) => ({
              adminUserId: a.id,
              userId: null,
              mobile: a.mobile,
              email: a.email,
              language: 'en',
            }))
          : await this.resolveRecipients(target);

      for (const who of recipients) {
        const disabled =
          isSuppressible(eventKey) && who.userId
            ? await this.repo.findDisabled(who.userId)
            : [];

        for (const channel of channels) {
          const suppressed = disabled.some(
            (d) =>
              d.channel === channel &&
              (d.eventKey === ALL_EVENTS_SENTINEL || d.eventKey === eventKey),
          );

          const copy = await this.renderFor({
            eventKey,
            channel,
            audience,
            locale: who.language,
            data: input.data ?? {},
          });

          if (!copy) {
            this.logger.warn(
              `No template or default copy for ${eventKey}/${channel}/${audience}`,
            );
            continue;
          }

          const deepLink = input.deepLink ?? copy.deepLink;

          if (channel === 'IN_APP') {
            // In-app is not a delivery — the row *is* the notification, so it
            // is written directly and never queued. Suppression still applies.
            if (!suppressed) {
              inApp.push({
                userId: who.userId,
                adminUserId: who.adminUserId,
                eventKey,
                audience,
                title: copy.title ?? def.description,
                body: copy.body,
                deepLink,
                data: (input.data ?? {}) as Prisma.InputJsonValue,
              });
            }
            continue;
          }

          outbox.push({
            eventKey,
            channel,
            audience,
            userId: who.userId,
            adminUserId: who.adminUserId,
            templateId: copy.templateId,
            title: copy.title,
            body: copy.body,
            deepLink,
            data: (input.data ?? {}) as Prisma.InputJsonValue,
            destination:
              channel === 'SMS'
                ? who.mobile
                : channel === 'EMAIL'
                  ? who.email
                  : null,
            status: suppressed ? 'SUPPRESSED' : 'QUEUED',
            suppressedReason: suppressed
              ? 'Disabled by user preference'
              : null,
          });
        }
      }
    }

    if (outbox.length > 0) await this.repo.enqueue(outbox);
    if (inApp.length > 0) await this.repo.createInApp(inApp);

    this.logger.debug(
      `emit ${eventKey}: ${outbox.length} queued, ${inApp.length} in-app`,
    );
    return { queued: outbox.length, inApp: inApp.length };
  }

  /**
   * Admin-editable template first, built-in default copy second.
   *
   * The fallback matters: it means a new event notifies correctly the moment
   * the code ships, without ops having to author 30 templates first — and that
   * nobody is tempted to skip the notification because the template is not
   * ready.
   */
  private async renderFor(input: {
    eventKey: string;
    channel: NotificationChannel;
    audience: NotificationAudience;
    locale: string;
    data: Record<string, unknown>;
  }) {
    const template = await this.repo.findTemplate({
      eventKey: input.eventKey,
      channel: input.channel,
      audience: input.audience,
      locale: input.locale,
    });

    const source = template ?? DEFAULT_COPY[input.eventKey]?.[input.audience];
    if (!source) return null;

    const title = source.title
      ? render(source.title, input.data)
      : undefined;
    const body = render(source.body, input.data);

    const missing = [...(title?.missing ?? []), ...body.missing];
    if (missing.length > 0) {
      // Rendered anyway — a sentence with a gap still reaches the customer,
      // and the log says exactly which variable the caller forgot.
      this.logger.warn(
        `${input.eventKey}/${input.channel}: missing template variables ${missing.join(', ')}`,
      );
    }

    return {
      templateId: template?.id ?? null,
      title: title?.text,
      body: body.text,
      deepLink: source.deepLink
        ? render(source.deepLink, input.data).text
        : undefined,
    };
  }

  /**
   * One recipient shape for both app roles, so `emit` does not branch on which
   * kind of id the caller happened to have.
   */
  private async resolveRecipients(target: EmitTarget): Promise<
    Array<{
      userId: string | null;
      adminUserId: string | null;
      mobile: string | null;
      email: string | null;
      language: string;
    }>
  > {
    const userId = await this.resolveUserId(target);
    if (!userId) return [];

    const user = await this.repo.findUserForNotify(userId);
    if (!user) return [];

    return [
      {
        userId: user.id,
        adminUserId: null,
        mobile: user.mobile,
        email: user.email,
        language: user.language,
      },
    ];
  }

  private async resolveUserId(target: EmitTarget): Promise<string | null> {
    if (target.userId) return target.userId;

    if (target.instructorId) {
      const row = await this.repo.findUserIdByInstructorId(target.instructorId);
      return row?.userId ?? null;
    }

    if (target.customerId) {
      const row = await this.repo.findUserIdByCustomerId(target.customerId);
      return row?.userId ?? null;
    }

    return null;
  }

  // ------------------------------------------------------------ in-app reads

  listInApp(userId: string, unreadOnly: boolean, page: number, limit: number) {
    return this.repo
      .listInApp(userId, unreadOnly, (page - 1) * limit, limit)
      .then(({ rows, total, unread }) => ({
        rows,
        meta: {
          page,
          limit,
          total,
          unread,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      }));
  }

  async markRead(userId: string, id: string) {
    const result = await this.repo.markRead(userId, id);
    return { id, updated: result.count, unread: await this.repo.countUnread(userId) };
  }

  async markAllRead(userId: string) {
    const result = await this.repo.markAllRead(userId);
    return { updated: result.count, unread: 0 };
  }


  /** The admin panel bell, scoped to the calling admin. */
  async listInAppForAdmin(
    adminUserId: string,
    unreadOnly: boolean,
    page: number,
    limit: number,
  ) {
    const { rows, total, unread } = await this.repo.listInAppForAdmin(
      adminUserId,
      unreadOnly,
      (page - 1) * limit,
      limit,
    );
    return {
      rows,
      meta: {
        page,
        limit,
        total,
        unread,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async markReadForAdmin(adminUserId: string, id: string) {
    const result = await this.repo.markReadForAdmin(adminUserId, id);
    return { id, updated: result.count };
  }
  // ----------------------------------------------------------- preferences

  async getPreferences(userId: string) {
    const rows = await this.repo.listPreferences(userId);
    return {
      // A missing row means "send everything", so the response says so rather
      // than returning an empty array the app has to interpret.
      defaultEnabled: true,
      overrides: rows,
    };
  }

  setPreference(
    userId: string,
    channel: NotificationChannel,
    eventKey: string | null,
    enabled: boolean,
  ) {
    return this.repo.setPreference({
      userId,
      channel,
      // Null from the DTO means "the whole channel"; stored as the sentinel.
      eventKey: eventKey ?? ALL_EVENTS_SENTINEL,
      enabled,
    });
  }
}
