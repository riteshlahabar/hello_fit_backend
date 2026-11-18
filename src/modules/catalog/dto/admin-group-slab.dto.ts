import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Group-size discounts (client pricing doc, 17 Nov 2026): 3 people -20%,
 * 5 people -30%, 10 people -50%. Read only for a service with
 * `allowMultiPerson`; a size with no row of its own falls back to the highest
 * `minPersons` at or below it. → `state/pricing-rules.md`
 */
export class ListGroupSlabsQueryDto {
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean = false;
}

export class CreateGroupSlabDto {
  /** Smallest group this row applies to. Unique across the table. */
  @IsInt()
  @Min(2)
  @Max(200)
  minPersons!: number;

  /** Percent off the gross. Positive means cheaper. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percentOff!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** `minPersons` is the row's identity; changing it is a create plus a retire. */
export class UpdateGroupSlabDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percentOff!: number;
}

export class SetGroupSlabStatusDto {
  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
