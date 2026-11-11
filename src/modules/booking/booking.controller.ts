import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { AvailabilityService } from '../availability/availability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate } from '../../common/dates/calendar';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import {
  CreateBookingDto,
  FindSlotsDto,
  ListMyBookingsQueryDto,
  QuoteBookingDto,
} from './dto/booking.dto';

/**
 * Customer-facing booking endpoints. Every route resolves the caller's
 * customer profile from the token rather than trusting an id in the payload —
 * that is what stops one customer reading or booking against another.
 */
@Controller('app/customer')
@AllowAudience('app')
@Roles('CUSTOMER')
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly availability: AvailabilityService,
    private readonly prisma: PrismaService,
  ) {}

  /** Slot grid for a service, date and address (spec 3.1 step 4). */
  @Get('slots')
  async slots(@Query() query: FindSlotsDto, @CurrentUser('id') userId: string) {
    await this.resolveCustomerId(userId);

    const slots = await this.availability.findSlots({
      serviceId: query.serviceId,
      date: this.parseDate(query.date),
      addressId: query.addressId,
      instructorId: query.instructorId,
    });

    return {
      data: slots,
      meta: { count: slots.length, date: query.date },
      message: slots.length === 0 ? 'No slots available for this date' : null,
    };
  }

  /** Price breakup before payment. Creates nothing. */
  @Post('bookings/quote')
  async quote(@Body() dto: QuoteBookingDto, @CurrentUser('id') userId: string) {
    const customerId = await this.resolveCustomerId(userId);
    return { data: await this.booking.quote(customerId, dto) };
  }

  /** Creates the booking and its sessions in PENDING_PAYMENT. */
  @Post('bookings')
  async create(
    @Body() dto: CreateBookingDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.resolveCustomerId(userId);
    const booking = await this.booking.create(customerId, dto);

    return {
      data: booking,
      message: 'Booking created. Complete payment to confirm.',
    };
  }

  @Get('bookings')
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: ListMyBookingsQueryDto,
  ) {
    const customerId = await this.resolveCustomerId(userId);
    const bookings = await this.booking.listForCustomer(customerId, query);

    return { data: bookings, meta: { count: bookings.length } };
  }

  @Get('bookings/:id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.resolveCustomerId(userId);
    return { data: await this.booking.getForCustomer(customerId, id) };
  }

  /**
   * The token carries the User id; bookings hang off CustomerProfile. Doing
   * this lookup here keeps the ownership rule in one place.
   */
  private async resolveCustomerId(userId: string): Promise<string> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, isBlocked: true, blockReason: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Complete your profile before booking',
      });
    }

    if (profile.isBlocked) {
      throw new BadRequestException({
        code: ErrorCode.FORBIDDEN,
        message:
          profile.blockReason ?? 'This account cannot make bookings. Contact support.',
      });
    }

    return profile.id;
  }

  private parseDate(value: string): Date {
    try {
      return parseCalendarDate(value);
    } catch {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'date must be a valid ISO date (YYYY-MM-DD)',
      });
    }
  }
}
