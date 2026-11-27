import {
  bucketOf,
  initialsOf,
  money,
  shortNameOf,
  slotOf,
  statusLabelOf,
} from './trainer-view';

/** The row shape pages 30, 32 and 37 all read. */
export interface BookingRowInput {
  id: string;
  sessionDate: Date;
  fromMinute: number;
  toMinute: number;
  durationMin: number;
  status: string;
  sessionValue: unknown;
  service: { id: string; name: string };
  address: { area: { name: string } | null; city: { name: string } | null };
  booking: {
    id: string;
    code: string;
    participantCount: number;
    customer: { id: string; name: string };
  };
}

export function toBookingRow(row: BookingRowInput) {
  return {
    sessionId: row.id,
    bookingId: row.booking.id,
    bookingCode: row.booking.code,
    status: row.status,
    bucket: bucketOf(row.status),
    statusLabel: statusLabelOf(row.status),
    client: {
      id: row.booking.customer.id,
      // First name plus an initial, and the area rather than the street: the
      // customer's full identity and address open on acceptance (spec 10.1).
      name: shortNameOf(row.booking.customer.name),
      initials: initialsOf(row.booking.customer.name),
    },
    service: row.service.name,
    slot: slotOf(row),
    persons: row.booking.participantCount,
    amount: money(row.sessionValue),
    area: [row.address.area?.name, row.address.city?.name]
      .filter(Boolean)
      .join(', '),
  };
}

/**
 * The five summary tiles. Counted over every visible status rather than the
 * filtered set, so tapping a filter chip never moves the numbers above it.
 */
export function summariseBuckets(
  counts: Array<{ status: string; _count: { _all: number } }>,
) {
  const tally = { total: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 };

  for (const row of counts) {
    tally.total += row._count._all;
    tally[bucketOf(row.status)] += row._count._all;
  }

  // Page 30's second tile reads "Upcoming": accepted and not yet delivered,
  // the same set the `confirmed` chip filters to.
  return { ...tally, upcoming: tally.confirmed };
}

/**
 * Page 30's cards — **one per booking, not per session** (client,
 * 27-11-2026), the same instruction page 24's request cards got that
 * morning and for the same reason: a session is the row the API returns, so
 * a five-session package drew five near-identical cards for one customer.
 *
 * The group carries what the whole booking is — the client, the service, the
 * money and how many sessions — and the sessions keep their own dates,
 * clocks and statuses under the arrow. **Each session keeps its `sessionId`**
 * because page 32 is keyed by the session, not the booking.
 *
 * Ordered by the group's own newest session, which is the order the rows
 * already arrive in, so the list does not reshuffle when it folds.
 */
export function toBookingGroups(rows: BookingRowInput[]) {
  const byBooking = new Map<string, BookingGroup>();

  for (const row of rows) {
    const view = toBookingRow(row);
    const group = byBooking.get(view.bookingId) ?? startGroup(view);

    group.sessions.push({
      sessionId: view.sessionId,
      status: view.status,
      bucket: view.bucket,
      statusLabel: view.statusLabel,
      service: view.service,
      slot: view.slot,
      amount: view.amount,
    });
    group.sessionCount = group.sessions.length;
    // The booking is worth the sum of the sessions the trainer is on, which
    // is not the booking's own `payable` — a cascade can split one booking
    // across two trainers, and this card is this trainer's share.
    group.amount += view.amount;
    byBooking.set(view.bookingId, group);
  }

  return [...byBooking.values()];
}

function startGroup(view: ReturnType<typeof toBookingRow>): BookingGroup {
  return {
    bookingId: view.bookingId,
    bookingCode: view.bookingCode,
    client: view.client,
    // The headline service and status come from the newest session, which is
    // the first one seen: a package is one service, and the card's pill says
    // where the booking has got to rather than inventing a summary state.
    service: view.service,
    status: view.status,
    bucket: view.bucket,
    statusLabel: view.statusLabel,
    area: view.area,
    persons: view.persons,
    amount: 0,
    sessionCount: 0,
    /** The session a tap on the card head opens, when there is only one. */
    sessionId: view.sessionId,
    sessions: [],
  };
}

export interface BookingGroupSession {
  sessionId: string;
  status: string;
  bucket: string;
  statusLabel: string;
  service: string;
  slot: ReturnType<typeof toBookingRow>['slot'];
  amount: number;
}

export interface BookingGroup {
  bookingId: string;
  bookingCode: string;
  client: ReturnType<typeof toBookingRow>['client'];
  service: string;
  status: string;
  bucket: string;
  statusLabel: string;
  area: string;
  persons: number;
  amount: number;
  sessionCount: number;
  sessionId: string;
  sessions: BookingGroupSession[];
}
