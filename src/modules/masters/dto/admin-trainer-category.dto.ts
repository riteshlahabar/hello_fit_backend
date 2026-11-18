import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Basic / Standard / Premium / Elite — the band a provider sits in (client,
 * 17 Nov 2026). It carries **no price**: the rate is `Service.basePrice`
 * whoever delivers the session. What a band decides is the **commission**,
 * through a `CommissionRule` with scope `TRAINER_CATEGORY`.
 * → `state/pricing-rules.md`
 */
export class ListTrainerCategoriesQueryDto {
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean = false;
}

export class CreateTrainerCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTrainerCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class SetTrainerCategoryStatusDto {
  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
