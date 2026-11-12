import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PINCODE_MESSAGE, PINCODE_RE } from '../../../common/validation/pincode';

/**
 * Shared list filters. Page/limit per the admin-table convention; `q` is a
 * case-insensitive contains match on the entity's name (or code).
 *
 * `includeInactive` defaults to false so every table shows the live set by
 * default — an ops user looking at "cities" means the ones in service.
 */
export class ListMastersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean = false;

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

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

export class CreateCityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Calendar day the city goes live. Date-only — see common/dates/calendar. */
  @IsOptional()
  @IsDateString()
  launchDate?: string;
}

export class UpdateCityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  launchDate?: string;
}

// ---------------------------------------------------------------------------
// Service area
// ---------------------------------------------------------------------------

export class ListAreasQueryDto extends ListMastersQueryDto {
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class CreateAreaDto {
  @IsUUID()
  cityId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  launchDate?: string;
}

/**
 * `cityId` is deliberately absent: moving an area between cities would orphan
 * every address and instructor-service-area row pointing at it. Delete and
 * recreate instead, which forces those rows to be dealt with.
 */
export class UpdateAreaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  launchDate?: string;
}

// ---------------------------------------------------------------------------
// Pincode
// ---------------------------------------------------------------------------

export class ListPincodesQueryDto extends ListMastersQueryDto {
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @IsOptional()
  @IsUUID()
  cityId?: string;
}

export class CreatePincodeDto {
  /**
   * Six digits, the Indian format. The column is VarChar(10).
   *
   * The shared rule, not a local `/^\d{6}$/`: that one allowed a leading zero,
   * so ops could attach `012345` to an area and no address could ever use it —
   * `CreateAddressDto` and the serviceability lookup both reject it. A PIN that
   * is storable but unresolvable is the drift
   * `common/validation/pincode.ts` exists to stop.
   */
  @IsString()
  @Matches(PINCODE_RE, { message: PINCODE_MESSAGE })
  code!: string;

  @IsUUID()
  areaId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePincodeDto {
  @IsOptional()
  @IsString()
  @Matches(PINCODE_RE, { message: PINCODE_MESSAGE })
  code?: string;

  @IsOptional()
  @IsUUID()
  areaId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Bulk attach. A city launch arrives as a list of pincodes, and doing that one
 * request at a time is what makes ops paste into a spreadsheet instead.
 */
export class BulkCreatePincodesDto {
  @IsUUID()
  areaId!: string;

  @IsString({ each: true })
  @Matches(PINCODE_RE, { each: true, message: PINCODE_MESSAGE })
  codes!: string[];
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

export class ListBranchesQueryDto extends ListMastersQueryDto {
  @IsOptional()
  @IsUUID()
  cityId?: string;
}

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsUUID()
  cityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** An AdminUser id. Must be an active admin — checked in the service. */
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

export class CreateLanguageDto {
  /** BCP-47-ish short code: `en`, `hi`, `mr`, `en-IN`. */
  @IsString()
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, {
    message: 'code must be a language code such as en, hi or en-IN',
  })
  @MaxLength(10)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateLanguageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

// ---------------------------------------------------------------------------
// Holiday
// ---------------------------------------------------------------------------

export class ListHolidaysQueryDto extends ListMastersQueryDto {
  /** Null city means a national holiday; this filters to one city's rows. */
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class CreateHolidayDto {
  /** Calendar day, `YYYY-MM-DD`. Never parsed with `new Date(y, m, d)`. */
  @IsDateString()
  date!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  /** Omit for a national holiday. */
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsBoolean()
  blocksBooking?: boolean;
}

export class UpdateHolidayDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsBoolean()
  blocksBooking?: boolean;
}
