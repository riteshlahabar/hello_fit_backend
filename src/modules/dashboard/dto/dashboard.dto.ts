import { IsDateString, IsOptional } from 'class-validator';

/**
 * The dashboard's only filter: which calendar day the booking, session and
 * payment counts describe. Defaults to **today** — client instruction,
 * 11 Nov 2026, with a date selector on the screen.
 *
 * Customer and instructor counts are platform totals and ignore it; 6.2 asks
 * for "total customer count", not a count of customers who signed up on a day.
 */
export class DashboardSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}
