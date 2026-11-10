import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { NotificationService } from './notification.service';
import { NotificationRepository } from './notification.repository';
import { ErrorCode } from '../../common/errors/error-codes';
import { eventDefinition, listEventDefinitions } from './events';
import { unknownPlaceholders } from './render';
import {
  ListOutboxQueryDto,
  TestNotificationDto,
  UpsertTemplateDto,
} from './dto/notification.dto';

/**
 * Notification administration: the event catalogue, template editing and the
 * delivery outbox.
 *
 * The outbox screen is the point of the whole design — "did the customer get
 * the reminder" is answerable from a table, with the rendered copy, the
 * attempt count and the provider's error, rather than from a log grep.
 */
@Controller('admin/notifications')
@AllowAudience('admin')
export class AdminNotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly repo: NotificationRepository,
  ) {}

  /**
   * The spec chapter-9 matrix as the admin panel renders it: every event, its
   * audiences, channels and available placeholders. Drives the template editor,
   * so ops never has to guess an event key or a variable name.
   */
  @Get('events')
  @RequirePermissions('cms:view')
  events() {
    const data = listEventDefinitions().map((def) => ({
      eventKey: def.eventKey,
      description: def.description,
      promotional: def.promotional ?? false,
      priority: def.priority ?? 'normal',
      variables: def.variables,
      channels: {
        customer: def.customer ?? [],
        instructor: def.instructor ?? [],
        admin: def.admin ?? [],
      },
    }));
    return { data, meta: { count: data.length } };
  }


  // -------------------------------------------------------------- admin bell

  /**
   * The admin panel's own notification list. Separate from
   * `/app/notifications` because the recipient is an `AdminUser`, not a
   * `User` — the two have different id spaces and cannot share a route.
   */
  @Get('inbox')
  @RequirePermissions('dashboard:view')
  async inbox(
    @CurrentUser('id') adminUserId: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { rows, meta } = await this.notifications.listInAppForAdmin(
      adminUserId,
      unreadOnly === 'true',
      Math.max(1, Number(page) || 1),
      Math.min(Math.max(1, Number(limit) || 20), 100),
    );
    return { data: rows, meta };
  }

  @Post('inbox/:id/read')
  @RequirePermissions('dashboard:view')
  @HttpCode(200)
  async readInbox(
    @CurrentUser('id') adminUserId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.notifications.markReadForAdmin(adminUserId, id),
    };
  }
  // --------------------------------------------------------------- templates

  @Get('templates')
  @RequirePermissions('cms:view')
  async listTemplates(
    @Query('eventKey') eventKey?: string,
    @Query('channel') channel?: 'PUSH' | 'SMS' | 'EMAIL' | 'IN_APP',
  ) {
    const rows = await this.repo.listTemplates({ eventKey, channel });
    return { data: rows, meta: { count: rows.length } };
  }

  /**
   * Upsert by `(eventKey, channel, audience, locale)`.
   *
   * Two validations before saving, both of which exist because a notification
   * is unreviewed customer-facing output: the event must be real, and the copy
   * may only reference variables that event actually emits. Without the second,
   * a typo ships as a sentence with a hole in it.
   */
  @Put('templates')
  @RequirePermissions('cms:edit')
  async upsertTemplate(@Body() dto: UpsertTemplateDto) {
    const def = eventDefinition(dto.eventKey);
    if (!def) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Unknown event key: ${dto.eventKey}`,
      });
    }

    const text = [dto.title ?? '', dto.body, dto.deepLink ?? ''].join(' ');
    const unknown = unknownPlaceholders(text, def.variables);
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `This event does not provide: ${unknown.join(', ')}`,
        details: { available: def.variables },
      });
    }

    const row = await this.repo.upsertTemplate({
      eventKey: dto.eventKey,
      channel: dto.channel,
      audience: dto.audience,
      locale: dto.locale ?? 'en',
      title: dto.title,
      body: dto.body,
      deepLink: dto.deepLink,
      providerRef: dto.providerRef,
      isActive: dto.isActive ?? true,
    });

    return { data: row, message: 'Template saved' };
  }

  /**
   * Soft-deletes a template. Delivery continues using the built-in default
   * copy, so removing a template degrades the wording rather than silencing
   * the event.
   */
  @Delete('templates/:id')
  @RequirePermissions('cms:delete')
  @HttpCode(200)
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    const existing = await this.repo.findTemplateById(id);
    if (!existing) {
      throw new BadRequestException({
        code: ErrorCode.NOT_FOUND,
        message: 'Template not found',
      });
    }
    await this.repo.softDeleteTemplate(id);
    return {
      data: { id, deleted: true },
      message: 'Template removed. The built-in copy will be used instead.',
    };
  }

  // ------------------------------------------------------------------ outbox

  @Get('outbox')
  @RequirePermissions('reports:view')
  async outbox(@Query() query: ListOutboxQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, total } = await this.repo.listOutbox({
      status: query.status,
      channel: query.channel,
      eventKey: query.eventKey,
      userId: query.userId,
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Puts a failed row back in the queue with its attempt count reset. */
  @Post('outbox/:id/retry')
  @RequirePermissions('reports:edit')
  @HttpCode(200)
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    return {
      data: await this.repo.requeue(id),
      message: 'Queued for another attempt',
    };
  }

  /**
   * Sends one event to the calling admin, so copy and delivery can be checked
   * before an event fires for real. Routed through `emit` rather than the
   * sender directly — a test that skips the rendering and preference layers
   * would not prove anything about what a customer receives.
   */
  @Post('test')
  @RequirePermissions('cms:edit')
  @HttpCode(200)
  async test(
    @Body() dto: TestNotificationDto,
    @CurrentUser('id') adminUserId: string,
  ) {
    if (!eventDefinition(dto.eventKey)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Unknown event key: ${dto.eventKey}`,
      });
    }

    // An admin token's subject is an AdminUser id, which has no devices and no
    // User row, so `admin: true` fans out to the users holding the ADMIN role
    // instead. Noted because it is not what the parameter name suggests.
    void adminUserId;

    const result = await this.notifications.emit(dto.eventKey, {
      data: dto.data ?? {},
      admin: true,
    });

    return {
      data: result,
      message:
        result.queued + result.inApp === 0
          ? 'Nothing was queued — this event has no admin audience in the matrix.'
          : 'Test notification queued',
    };
  }
}
