import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { FavouriteService } from './favourite.service';

/**
 * Saved trainers — client instruction, 13 Nov 2026.
 *
 * Every route is the signed-in customer's own; there is no id in any path but
 * the provider's, so one customer cannot read another's list.
 *
 * `POST` and `DELETE` are both **idempotent**. The heart is a toggle that can
 * be tapped twice in a second on a phone, and neither direction should ever
 * return an error for "already done".
 */
@Controller('favourites')
@AllowAudience('app')
@Roles('CUSTOMER')
export class FavouriteController {
  constructor(private readonly favourites: FavouriteService) {}

  @Get()
  async list(@CurrentUser('id') userId: string) {
    const rows = await this.favourites.list(userId);

    return {
      data: rows,
      meta: { total: rows.length, empty: rows.length === 0 },
      message: rows.length === 0 ? 'You have not saved any trainers yet' : null,
    };
  }

  /** Just the ids — what the search page needs to fill its hearts. */
  @Get('ids')
  async ids(@CurrentUser('id') userId: string) {
    return { data: await this.favourites.ids(userId) };
  }

  @Post(':instructorId')
  @HttpCode(HttpStatus.OK)
  async add(
    @Param('instructorId', ParseUUIDPipe) instructorId: string,
    @CurrentUser('id') userId: string,
  ) {
    const saved = await this.favourites.add(userId, instructorId);
    return { data: saved, message: `${saved.name} saved` };
  }

  @Delete(':instructorId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('instructorId', ParseUUIDPipe) instructorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return {
      data: await this.favourites.remove(userId, instructorId),
      message: 'Removed from your saved trainers',
    };
  }
}
