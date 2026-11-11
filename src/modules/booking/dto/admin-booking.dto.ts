import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PaymentStatus,
  SessionStatus,
} from '../../../generated/prisma/enums';

/**
 * Filters for the admin booking table (PDF 6.6 — "search bookings using
 * supported criteria", "review payment status where applicable").
 *
 * `status` matches a booking with **any** session in that state, because a
 * package booking has many sessions and the operator is looking for the
 * booking, not the occurrence.
 */
export class ListBookingsQueryDto {
  /** Booking code, or the customer's name or mobile. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * Admin cancellation (PDF 6.6 — "perform permitted administrative status
 * actions"). The reason is mandatory and reaches `booking_status_history`,
 * which is the record 6.6 calls for.
 */
export class AdminCancelBookingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
