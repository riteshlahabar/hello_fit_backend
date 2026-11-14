import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Slug is derived from the name, never sent — one spelling, one source. */
export class CreatePlanDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 8)
  icon?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  eyebrow?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  description?: string;

  /**
   * Rupees per month. **Zero is valid and meaningful** — the design's Starter
   * tier is free, so this is `@Min(0)`, not `@Min(1)`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  priceMonthly?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  priceYearly?: number;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  billingCaption?: string;

  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlanDto extends CreatePlanDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  declare name: string;
}

/** One ✓ / – line on a card. */
export class PlanFeatureDto {
  @IsString()
  @Length(1, 120)
  label!: string;

  /** ✓ when true, – when false. Defaults to included. */
  @IsOptional()
  @IsBoolean()
  included?: boolean;
}

/**
 * The whole list, every time. The dialog edits rows together — reordering,
 * adding and removing in one pass — so a per-row PATCH API would need the
 * client to replay that as a sequence and get the order right.
 */
export class ReplacePlanFeaturesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureDto)
  features!: PlanFeatureDto[];
}

export class ListPlansQueryDto {
  /**
   * The admin screen's Active / Inactive / All filter.
   *
   * **A string, not a boolean, on purpose.** `main.ts` runs the global
   * ValidationPipe with `enableImplicitConversion: true`, and that coerces a
   * query value to the property's declared type — so a `boolean` field turns
   * `"false"` into `Boolean("false")`, which is `true`. The Inactive filter
   * then returned the active plans and looked like a database bug.
   * smoke:plans caught it; a build never would have.
   *
   * Kept as the literal string and converted in the service, where the
   * conversion is visible.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';
}
