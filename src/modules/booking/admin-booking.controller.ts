import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { BookingService } from './booking.service';
import {
  AdminCancelBookingDto,
  ListBookingsQueryDto,
} from './dto/admin-booking.dto';

/**
 * Booking management (PDF 6.6) plus payment confirmation.
 *
 * 6.6 asks for: view records, search, customer and provider references,
 * service/date/time/status, payment status, the acceptance-rejection-
 * cancellation record, permitted status actions, and detail for support. The
 * three routes below cover those; the status history on the detail response is
 * the record.
 *
 * Payment confirmation lives here until the Razorpay webhook exists — it is
 * also the permanent route for recording a cash or manual payment, so it does
 * not go away afterwards.
 */
@Controller('admin')
@AllowAudience('admin')
export class AdminBookingController {
  constructor(private readonly booking: BookingService) {}

  @Get('bookings')
  @RequirePermissions('bookings:view')
  async list(@Query() query: ListBookingsQueryDto) {
    const { rows, meta } = await this.booking.listForAdmin(query);
    return { data: rows, meta };
  }

  /** Sessions, payments and the full status history. */
  @Get('bookings/:id')
  @RequirePermissions('bookings:view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.booking.getForAdmin(id) };
  }

  /**
   * Cancels every session not already finished or cancelled. Does **not**
   * issue a refund — that is the refund module's job, with its own policy and
   * its own audit.
   */
  @Post('bookings/:id/cancel')
  @RequirePermissions('bookings:edit')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCancelBookingDto,
    @CurrentUser('id') adminUserId: string,
  ) {
    const result = await this.booking.cancelForAdmin(id, dto.reason, adminUserId);
    return {
      data: result,
      message: `Cancelled ${result.cancelledSessions} session(s). Any refund is raised separately.`,
    };
  }

  @RequirePermissions('finance:edit')
  @Post('bookings/:id/confirm-payment')
  async confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
  ) {
    const result = await this.booking.confirmPayment(id, adminUserId, 'ADMIN');

    return {
      data: result,
      message: 'Payment confirmed and sessions released for assignment',
    };
  }
}
