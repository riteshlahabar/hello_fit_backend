/**
 * Minute-of-day → the clock a person reads.
 *
 * A slot is stored as `fromMinute` / `toMinute`, whole minutes since local
 * midnight, so no timezone is involved and nothing here touches `Date`. That
 * is the point: `sessionStartsAt` in `calendar.ts` builds an instant and is
 * the wrong tool for a label.
 *
 * Rule 4 covers dates; the clock beside them is 12-hour on every trainer
 * screen in the client's HTML pack ("09:00 AM", "7:00 AM – 8:00 AM").
 */

const pad = (value: number): string => String(value).padStart(2, '0');

/** `570` → `09:30 AM`. */
export function formatClock(minuteOfDay: number): string {
  const minutes = ((minuteOfDay % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return `${pad(hour12)}:${pad(minutes % 60)} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

/** `09:30` and `AM` apart, for the two-line schedule card on page 24. */
export function splitClock(minuteOfDay: number): {
  time: string;
  meridiem: string;
} {
  const [time, meridiem] = formatClock(minuteOfDay).split(' ');
  return { time, meridiem };
}

/** `09:00 AM – 10:00 AM`, the range pages 32 and 33 print. */
export function formatClockRange(fromMinute: number, toMinute: number): string {
  return `${formatClock(fromMinute)} – ${formatClock(toMinute)}`;
}
