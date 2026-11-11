import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Mirrors the Prisma `DiscountType` enum without importing the client here. */
export enum DiscountTypeDto {
  PERCENT = 'PERCENT',
  FLAT = 'FLAT',
}

/**
 * Validity filter for the admin table. `valid` is the set a customer could
 * use today; `expired` and `upcoming` are the two ways a row can be live but
 * useless, which is what ops actually wants to see separately.
 */
export enum CouponValidityFilter {
  ALL = 'all',
  VALID = 'valid',
  UPCOMING = 'upcoming',
  EXPIRED = 'expired',
}

export enum CouponStatusFilter {
  ALL = 'all',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export class ListCouponsQueryDto {
  /** Case-insensitive contains match on the code. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  q?: string;

  @IsOptional()
  @IsEnum(CouponStatusFilter)
  status?: CouponStatusFilter = CouponStatusFilter.ALL;

  @IsOptional()
  @IsEnum(CouponValidityFilter)
  validity?: CouponValidityFilter = CouponValidityFilter.ALL;

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

export class CreateCouponDto {
  /**
   * Upper-cased by the service before it is stored, so `save20` and `SAVE20`
   * are the same code and cannot both exist.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, digits, hyphen and underscore',
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsEnum(DiscountTypeDto)
  discountType!: DiscountTypeDto;

  @IsNumber()
  @Min(0.01)
  discountValue!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minBookingAmount?: number;

  /** Calendar day (YYYY-MM-DD), inclusive. */
  @IsDateString()
  validFrom!: string;

  /** Calendar day (YYYY-MM-DD), inclusive. */
  @IsDateString()
  validTo!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLimit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Every field optional — the panel sends only what changed. `code` is
 * editable while the coupon has never been redeemed; the service refuses it
 * afterwards, because the code is what a past booking was priced against.
 */
export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, digits, hyphen and underscore',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsEnum(DiscountTypeDto)
  discountType?: DiscountTypeDto;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minBookingAmount?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLimit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetCouponStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

/**
 * The customer-side check behind US-A09's "the applicable discount is
 * displayed before payment". `amount` is the charge the discount applies to —
 * the panel and the app both take it from the quote's `grossAmount` plus
 * add-ons, never from a figure the customer can type.
 */
export class ValidateCouponDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}

