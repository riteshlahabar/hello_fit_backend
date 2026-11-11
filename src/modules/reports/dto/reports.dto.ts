import { IsDateString, IsOptional } from 'class-validator';

/** How far back the default range reaches when neither end is given. */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * The only filter every report in PDF 6.12 takes: a calendar-day range,
 * **inclusive at both ends**.
 *
 * Both ends are optional and default to the last 30 days, so a report opens
 * with something in it rather than empty. The reversed-range check lives in
 * `ReportsService` rather than here — class-validator cannot compare two
 * fields, and a 400 that names which end is wrong is worth more than a
 * generic one.
 *
 * These are **days, not instants**. `ReportsService` turns them into the
 * half-open instant window the queries need via `common/dates/calendar.ts`;
 * passing a raw `new Date(from)` is the off-by-one-day bug in
 * `state/gotchas.md`.
 */
export class ReportRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
