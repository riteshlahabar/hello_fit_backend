import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Packages are global since 17 Nov 2026: six rows for the whole catalogue,
 * not six per service. They hold a **percent**, never a price — the money
 * comes from `Service.basePrice`. → `state/pricing-rules.md`
 */
export class ListPackagesQueryDto {
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

export class CreatePackageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  /**
   * The symbol shown on the package card — an emoji or a glyph. Decoration:
   * an empty string clears it and the card falls back to its own mark.
   */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  /** Sessions the customer pays for. */
  @IsInt()
  @Min(1)
  @Max(365)
  sessionCount!: number;

  /** Days the package stays usable from the first session. */
  @IsInt()
  @Min(1)
  @Max(730)
  validityDays!: number;

  /**
   * Signed percent on the gross: +20 is the trial markup, -15 the 90-day
   * intensive discount. Below -100 the booking would owe the customer money.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100)
  @Max(999)
  percentAdjust?: number;

  /** Delivered on top of `sessionCount`, charged and paid to nobody. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  freeSessionCount?: number;

  /** 0 = Sunday to 6 = Saturday. Empty means any weekday. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  allowedWeekdays?: number[];

  @IsOptional()
  @IsBoolean()
  fixedInstructorAllowed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Every field optional; `isActive` moves through the status route instead. */
export class UpdatePackageDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  /** Empty string clears the symbol; absent leaves it alone. */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  sessionCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  validityDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100)
  @Max(999)
  percentAdjust?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  freeSessionCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  allowedWeekdays?: number[];

  @IsOptional()
  @IsBoolean()
  fixedInstructorAllowed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class SetPackageStatusDto {
  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
