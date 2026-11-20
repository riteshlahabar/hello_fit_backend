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
