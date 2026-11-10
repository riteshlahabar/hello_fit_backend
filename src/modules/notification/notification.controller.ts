import {
  Body,
  Controller,
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
  Roles,
} from '../../common/decorators/auth.decorators';
import { NotificationService } from './notification.service';
import {
  ListInAppQueryDto,
  SetPreferenceDto,
} from './dto/notification.dto';

/**
 * The bell icon and the notification settings screen, for both app roles.
 *
 * Every route is scoped to the caller's own `userId` — `markRead` filters on
 * `(id, userId)` together, so another user's notification id updates nothing
 * rather than being marked read.
 */
@Controller('app/notifications')
@AllowAudience('app')
@Roles('CUSTOMER', 'INSTRUCTOR')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: ListInAppQueryDto,
  ) {
    const { rows, meta } = await this.notifications.listInApp(
      userId,
      Boolean(query.unreadOnly),
      query.page ?? 1,
      query.limit ?? 20,
    );
    return { data: rows, meta };
  }

  /** Just the badge count — cheaper than listing when the app only needs it. */
  @Get('unread-count')
  async unreadCount(@CurrentUser('id') userId: string) {
    const { meta } = await this.notifications.listInApp(userId, true, 1, 1);
    return { data: { unread: meta.unread } };
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.notifications.markRead(userId, id) };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser('id') userId: string) {
    return {
      data: await this.notifications.markAllRead(userId),
      message: 'All notifications marked read',
    };
  }

  // -------------------------------------------------------------- preferences

  @Get('preferences')
  async preferences(@CurrentUser('id') userId: string) {
    return { data: await this.notifications.getPreferences(userId) };
  }

  /**
   * A `PUT` because it is an idempotent upsert of one (channel, event) pair,
   * not a new resource each time the user flips the switch.
   */
  @Put('preferences')
  async setPreference(
    @CurrentUser('id') userId: string,
    @Body() dto: SetPreferenceDto,
  ) {
    return {
      data: await this.notifications.setPreference(
        userId,
        dto.channel,
        dto.eventKey ?? null,
        dto.enabled,
      ),
      message: 'Preference saved',
    };
  }
}
