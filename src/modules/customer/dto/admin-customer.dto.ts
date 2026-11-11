import {
  IsBoolean,
  IsDateString,
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
  Gender,
  TrustBand,
  UserStatus,
} from '../../../generated/prisma/enums';

/**
 * Filters for the customer table (spec 5.3). Page/limit per the admin-table
 * convention; `q` matches name, mobile or email.
 *
 * `includeDeleted` rather than `includeInactive`: a customer is never
 * "inactive" — the row is either live or soft-deleted, the same distinction
 * `admin-users` draws.
 */
export class ListCustomersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /** The account's status, which lives on `User`, not on the profile. */
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(TrustBand)
  trustBand?: TrustBand;

  /** The blacklist flag, which lives on `CustomerProfile`. */
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean = false;

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
 * The fields ops may correct on someone else's behalf — a support call where
 * the customer cannot get the app to save.
 *
 * Deliberately not here: `trustScore`, `trustBand` and `referralCode`.
 * The first two are derived from teacher-to-customer reviews and behaviour
 * flags (spec 4.6), so an admin editing them would overwrite the calculation
 * at the next recompute; the third is a unique key other customers' referrals
 * point at. `isBlocked` has its own route, below.
 */
export class AdminUpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  goal?: string;

  /** Conditions and injuries the teacher must read before arriving. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  healthNotes?: string;
}

/**
 * Suspend or reinstate the account. The reason reaches the audit log, and
 * suspending revokes the customer's refresh tokens so the app session ends
 * rather than running until the access token expires.
 */
export class ChangeCustomerStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/**
 * The blacklist, which is not the same thing as a suspension: a blocked
 * customer can still sign in and see their history, but booking refuses them.
 * Reason is mandatory when blocking and ignored when clearing it.
 */
export class BlockCustomerDto {
  @IsBoolean()
  isBlocked!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
