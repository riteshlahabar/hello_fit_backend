import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SessionFormat } from '../../../generated/prisma/enums';

/** Comma-separated query values — `?categoryId=a,b` — into an array. */
const csv = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.split(',').map((part) => part.trim()).filter(Boolean);
};

export const PROVIDER_SORTS = ['rating', 'price', 'experience'] as const;
export type ProviderSort = (typeof PROVIDER_SORTS)[number];

/**
 * The Find a Trainer filters, one field per control in the supplied design —
 * PDF §5.5 "filter using agreed parameters, such as location, service
 * category, price and availability".
 *
 * Every one is optional: the page must render with no filters at all, and
 * §5.5's "handle no-result conditions" is about an empty result, not a refusal.
 */
export class SearchProvidersQueryDto {
  /** Sidebar "Fitness category" checkboxes. Multi-select, so OR within. */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsUUID('4', { each: true })
  categoryId?: string[];

  /** The `#city` dropdown at the top of the page. */
  @IsOptional()
  @IsUUID()
  cityId?: string;

  /** Narrower than a city — one service area. */
  @IsOptional()
  @IsUUID()
  areaId?: string;

  /** Sidebar "Session location" checkboxes. */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsEnum(SessionFormat, { each: true })
  sessionFormat?: SessionFormat[];

  /**
   * Sidebar "Price per session", which reads "Up to ₹X" — so this is a
   * ceiling, matched against the provider's own `customPrice` where they set
   * one and the service's `basePrice` where they did not.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  maxPrice?: number;

  /** Sidebar "Minimum rating": Any / 4.0+ / 4.5+ / 4.8+. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  /** Free-text over name and specialisations. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(PROVIDER_SORTS)
  sort?: ProviderSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit?: number;
}
