/**
 * `dd-mm-yyyy` on the wire and on every screen (client, 19-11-2026 — hard rule
 * 4 in `claude.md`, detail in `state/date-format.md`).
 *
 * Formatting only. A session date is a calendar day normalised to UTC midnight
 * and that is `common/dates/calendar.ts`'s job — do not mix the two. These
 * helpers read a `Date` and produce the string a person sees; nothing here is
 * ever stored, because a `date` column holds a day, not characters.
 *
 * Rollout is file-by-file: new code uses these, old code converts as it is
 * touched. An endpoint already shipped to all four surfaces is only flipped
 * with the client's go-ahead for that screen.
 */

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * `19-11-2026`. Read in UTC, because a calendar day is stored at UTC midnight
 * and reading it in the server's zone would show the day before.
 */
export function formatDate(value: Date): string {
  return [
    pad(value.getUTCDate()),
    pad(value.getUTCMonth() + 1),
    value.getUTCFullYear(),
  ].join('-');
}

/** `19-11-2026 14:30:05`. The same day, with the clock. */
export function formatDateTime(value: Date): string {
  const clock = [
    pad(value.getUTCHours()),
    pad(value.getUTCMinutes()),
    pad(value.getUTCSeconds()),
  ].join(':');

  return `${formatDate(value)} ${clock}`;
}

/** Null in, null out — for the many nullable date columns. */
export function formatDateOrNull(value: Date | null | undefined): string | null {
  return value ? formatDate(value) : null;
}

export function formatDateTimeOrNull(
  value: Date | null | undefined,
): string | null {
  return value ? formatDateTime(value) : null;
}

/** Four letters is a month name, so `19-11-2026` and never `11-19-2026`. */
const DDMMYYYY = /^(\d{2})-(\d{2})-(\d{4})$/;

/**
 * Reads `dd-mm-yyyy` back, for request bodies. Returns null on anything else,
 * including a real date that is written the other way round — the caller
 * decides whether that is a 400 or a fall-through to ISO, because both formats
 * are still accepted on input during the rollout.
 */
export function parseDdMmYyyy(value: string): Date | null {
  const match = DDMMYYYY.exec(value.trim());
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Date.UTC rolls 31-02 forward into March rather than failing, so the only
  // way to reject an impossible day is to read the result back.
  const roundTrips =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return roundTrips ? parsed : null;
}
