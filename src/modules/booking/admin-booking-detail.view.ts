/**
 * The two shapes the admin panel's booking View dialog needs, on top of the
 * `dd-mm-yyyy` walk in `admin-booking.view.ts` (client, 23-11-2026).
 *
 *   1. **A day beside every session date.** The dialog lists a package's
 *      sessions and the client wants the weekday next to the date — "Mon,
 *      Tue, Wed like that, after the date column". Computed here and sent as
 *      `sessionDay`, because by the time the panel has the row the date is
 *      already the `dd-mm-yyyy` string rule 4 asks for, and
 *      `new Date('24-11-2026')` is `Invalid Date` — the panel must never
 *      re-parse it (`state/date-format.md`).
 *
 *   2. **One history entry per change, not one per session.** Every
 *      transition is written per session: `confirmPayment` and
 *      `cancelForAdmin` both `createMany` a row for each session in the
 *      booking, so a 10-session package showed the same "Pending payment →
 *      Confirmed" line ten times and the record was unreadable. The rows stay
 *      in the table — they are the per-session audit trail, and a single
 *      session can still move on its own — but the dialog gets them collapsed
 *      to the change itself, carrying how many sessions it covered.
 *
 * Kept out of `admin-booking.view.ts` so each file stays one job: that one is
 * the date walk every admin booking route uses, this one is the detail dialog.
 */
import { formatWeekday } from '../../common/dates/format';
import { formatBookingDates } from './admin-booking.view';

export interface HistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface SessionRow {
  sessionDate: Date;
}

/**
 * Same change, same actor, same reason, same second → one entry.
 *
 * Truncated to the second rather than compared exactly: the rows of one
 * `createMany` share a transaction timestamp today, but that is Postgres's
 * `now()` behaviour and not something this screen should depend on. Two
 * genuinely separate changes land in the same second only if they are also
 * the same transition by the same actor for the same reason, which is the
 * case where collapsing them is right anyway.
 */
const changeKeyOf = (row: HistoryRow): string =>
  [
    row.fromStatus ?? '—',
    row.toStatus,
    row.actorType,
    row.actorId ?? '—',
    row.reason ?? '—',
    Math.floor(row.createdAt.getTime() / 1000),
  ].join('|');

/** One row per change, in the order they arrived, each with a session count. */
export function collapseStatusHistory<T extends HistoryRow>(
  history: T[],
): (T & { sessions: number })[] {
  const byChange = new Map<string, T & { sessions: number }>();

  for (const row of history) {
    const key = changeKeyOf(row);
    const seen = byChange.get(key);

    if (seen) seen.sessions += 1;
    else byChange.set(key, { ...row, sessions: 1 });
  }

  return [...byChange.values()];
}

/**
 * The detail response: the weekday added, the history collapsed, then every
 * date formatted. **Order matters** — both steps need real `Date` objects, so
 * they run before the walk turns them into strings.
 */
export function formatBookingDetail<
  T extends { sessions: SessionRow[]; statusHistory: HistoryRow[] },
>(booking: T) {
  return formatBookingDates({
    ...booking,
    sessions: booking.sessions.map((session) => ({
      ...session,
      sessionDay: formatWeekday(session.sessionDate),
    })),
    statusHistory: collapseStatusHistory(booking.statusHistory),
  });
}
