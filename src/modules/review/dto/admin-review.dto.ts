import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReviewDirection, ReviewState } from '../../../generated/prisma/enums';

/**
 * Filters for the review table (PDF 6.10 — "reviews can be located and
 * viewed").
 *
 * **Both directions are listed** — client instruction, 10 Nov 2026. The
 * provider's review of the customer is internal: admins see it, the customer
 * never does. `direction` filters to one side when an operator wants it.
 */
export class ListReviewsQueryDto {
  /** Booking code, or the customer's or provider's name. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(ReviewState)
  state?: ReviewState;

  @IsOptional()
  @IsEnum(ReviewDirection)
  direction?: ReviewDirection;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

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
