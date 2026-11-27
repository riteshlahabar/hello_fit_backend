import { initialsOf, shortNameOf, slotOf } from './trainer-view';

/** One pending `Assignment`, as the page-24 query selects it. */
export interface PendingRequestRow {
  id: string;
  mode: string;
  session: {
    id: string;
    sessionDate: Date;
    fromMinute: number;
    toMinute: number;
    durationMin: number;
    service: { name: string };
    booking: { id: string; code: string; customer: { name: string } };
  };
}

/**
 * Page 24's `.request` cards — **one card per booking, not per session**
 * (client, 27-11-2026).
 *
 * An `Assignment` is offered per *session*, so a five-session package the
 * customer booked with this trainer arrived as five identical cards reading
 * "New client request". The client's words: one customer is one booking
 * request, and under it the sessions. So the rows are folded by
 * `booking.id`, the card carries the client's name, and each session keeps
 * its own `requestId` — accept and reject answer one session at a time, and
 * that has not changed.
 *
 * Ordered by the session that comes soonest, and chronological inside a
 * group: the trainer answers the one that is about to happen first.
 */
export function toRequestGroups(rows: PendingRequestRow[]) {
  const byBooking = new Map<string, RequestGroup>();

  for (const row of [...rows].sort(byStart)) {
    const { booking } = row.session;
    const group = byBooking.get(booking.id) ?? startGroup(row);

    group.sessions.push(toRequestSession(row));
    group.sessionCount = group.sessions.length;
    byBooking.set(booking.id, group);
  }

  return [...byBooking.values()];
}

/** The card: who is asking, and nothing the sessions below already say. */
function startGroup(row: PendingRequestRow): RequestGroup {
  const name = row.session.booking.customer.name;

  return {
    id: row.session.booking.id,
    bookingCode: row.session.booking.code,
    // Kept for the build of the app that opened one session off the card.
    sessionId: row.session.id,
    initials: initialsOf(name),
    // The client's name is the heading now — "New client request" was the
    // same words on every card (client, 27-11-2026).
    title: shortNameOf(name),
    subtitle: `From ${shortNameOf(name)} · ${row.session.service.name}`,
    mode: row.mode,
    sessionCount: 0,
    sessions: [],
  };
}

/** One row inside an opened card, with the Review button's session on it. */
function toRequestSession(row: PendingRequestRow) {
  return {
    /** The `Assignment` — what accept and reject are keyed by. */
    requestId: row.id,
    /** The session — what Review opens page 32 for. */
    sessionId: row.session.id,
    service: row.session.service.name,
    slot: slotOf(row.session),
    mode: row.mode,
  };
}

export interface RequestGroup {
  id: string;
  bookingCode: string;
  sessionId: string;
  initials: string;
  title: string;
  subtitle: string;
  mode: string;
  sessionCount: number;
  sessions: ReturnType<typeof toRequestSession>[];
}

/** Soonest first — the date, then the clock. */
function byStart(a: PendingRequestRow, b: PendingRequestRow): number {
  return (
    a.session.sessionDate.getTime() - b.session.sessionDate.getTime() ||
    a.session.fromMinute - b.session.fromMinute
  );
}
