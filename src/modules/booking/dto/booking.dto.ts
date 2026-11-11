import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Minutes from midnight: 0 to 1439. */
const MINUTE_MIN = 0;
const MINUTE_MAX = 1_439;

export class QuoteBookingDto {
  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsUUID()
  packageId?: string;

  /** Ignored when a package is supplied — the package defines its own count. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  sessionCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  addonIds?: string[];

  /** Distance to the address, for the travel-charge slabs. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  distanceKm?: number;

  /**
   * A promotional code (PDF 6.9). When present the server validates it and
   * computes the discount itself, ignoring `discount` below — the figure the
   * customer is charged is never one the client sent.
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  couponCode?: string;

  /**
   * Membership or manually agreed discount, in rupees. Capped by the pricing
   * calculator. Superseded by `couponCode` when both are sent.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  walletApplied?: number;
}

export class CreateBookingDto extends QuoteBookingDto {
  @IsUUID()
  addressId!: string;

  /** ISO date (YYYY-MM-DD). First occurrence for a package. */
  @IsDateString()
  sessionDate!: string;

  @IsInt()
  @Min(MINUTE_MIN)
  @Max(MINUTE_MAX)
  fromMinute!: number;

  /** Defaults to fromMinute + the service duration. */
  @IsOptional()
  @IsInt()
  @Min(MINUTE_MIN)
  @Max(MINUTE_MAX)
  toMinute?: number;

  /** Package only: 0 = Sunday to 6 = Saturday. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @Type(() => Number)
  weekdays?: number[];

  /** Omit for auto-assign; set to request a specific teacher. */
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  /** Gender, language, "same teacher for all sessions" (spec 3.1 step 6). */
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}

export class FindSlotsDto {
  @IsUUID()
  serviceId!: string;

  @IsDateString()
  date!: string;

  @IsUUID()
  addressId!: string;

  @IsOptional()
  @IsUUID()
  instructorId?: string;
}
