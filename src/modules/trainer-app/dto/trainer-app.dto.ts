import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A DTO per query rather than bare `@Query()` strings, for the reason
 * `ListMyBookingsQueryDto` records: an unvalidated filter reached the `where`
 * builder and a typo silently became a different query instead of a 400.
 */
export class TrainerBookingsQueryDto {
  @IsOptional()
  @IsIn(['all', 'pending', 'confirmed', 'completed', 'cancelled'])
  status?: 'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class TrainerClientsQueryDto {
  @IsOptional()
  @IsIn(['all', 'active', 'inactive'])
  status?: 'all' | 'active' | 'inactive';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class TrainerEarningsQueryDto {
  @IsOptional()
  @IsIn(['week', 'month', 'quarter', 'year'])
  period?: 'week' | 'month' | 'quarter' | 'year';
}

/** Page 33 — the confirmation note is optional and goes to the client. */
export class AcceptRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * Page 34 — the reason is compulsory. Free text, not an enum: the seven
 * options the page lists are a UI affordance, and there is no reason master
 * to validate against (`state/open-points/backend-gaps.md`).
 */
export class RejectRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
