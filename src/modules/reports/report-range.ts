import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  addCalendarDays,
  calendarDaysBetween,
  formatCalendarDate,
  parseCalendarDate,
  sessionStartsAt,
  todayCalendar,
} from '../../common/dates/calendar';
import { DEFAULT_RANGE_DAYS, type ReportRangeQueryDto } from './dto/reports.dto';

/** Longest range a single report will answer, in days. */
export const MAX_RANGE_DAYS = 366;

/** The calendar range a report describes, plus the instants to query with. */
export interface Range {
  fromDay: Date;
  toDay: Date;
  /** Local midnight on `fromDay` — inclusive. */
  start: Date;
  /** Local midnight *after* `toDay` — exclusive, which makes `toDay` count. */
  end: Date;
  days: number;
}

/**
 * The range every PDF 6.12 report shares. No DB and no HTTP — this is where
 * the one rule that matters lives, so it can be reasoned about in one place:
 *
 * **A range is calendar days, inclusive at both ends.** A request for
 * 1–7 November includes the 7th, which means querying up to local midnight on
 * the **8th**. `end` is that exclusive bound; every repository window is
 * `gte: start, lt: end`. Building it any other way is the off-by-one-day bug
 * in `state/gotchas.md`.
 */
export function resolveRange(query: ReportRangeQueryDto): Range {
  const toDay = query.to ? parseCalendarDate(query.to) : todayCalendar();

  // Defaults to the last 30 days ending today, so a report never opens empty.
  const fromDay = query.from
    ? parseCalendarDate(query.from)
    : addCalendarDays(toDay, -(DEFAULT_RANGE_DAYS - 1));

  if (toDay < fromDay) {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message: '`to` cannot be earlier than `from`',
    });
  }

  const days = calendarDaysBetween(fromDay, toDay) + 1;

  // Refused rather than truncated: over a year is a mistake, not an intention,
  // and the bookings report would load a year of rows into memory to bucket.
  if (days > MAX_RANGE_DAYS) {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message: `A report covers at most ${MAX_RANGE_DAYS} days; this range is ${days}`,
    });
  }

  return {
    fromDay,
    toDay,
    start: sessionStartsAt(fromDay, 0),
    end: sessionStartsAt(addCalendarDays(toDay, 1), 0),
    days,
  };
}

/**
 * The range as every report's response carries it. Echoing it back is what
 * makes US-A12's "summary values correspond to the relevant records and
 * filters" checkable: the screen shows what it asked for, not the default it
 * silently got.
 */
export function rangeMeta(range: Range) {
  return {
    from: formatCalendarDate(range.fromDay),
    to: formatCalendarDate(range.toDay),
    days: range.days,
  };
}

/** Every calendar day in the range, as `YYYY-MM-DD` keys, in order. */
export function rangeDayKeys(range: Range): string[] {
  return Array.from({ length: range.days }, (_, i) =>
    formatCalendarDate(addCalendarDays(range.fromDay, i)),
  );
}

/** Money rounded to paise, so a sum of Decimals never shows a float tail. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
