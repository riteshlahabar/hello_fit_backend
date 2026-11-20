import { formatDate } from '../../common/dates/format';
import { initialsOf, money, shortNameOf } from './trainer-view';

/** One row of `BookingSession` as the clients list reads it. */
export interface ClientSessionRow {
  id: string;
  sessionDate: Date;
  fromMinute: number;
  durationMin: number;
  status: string;
  sessionValue: unknown;
  service: { name: string };
  booking: { customer: { id: string; name: string; createdAt: Date } };
}

export interface TrainerClient {
  id: string;
  name: string;
  initials: string;
  /** The service they book most often with this trainer. */
  service: string;
  sessions: number;
  completed: number;
  upcoming: number;
  /** What the trainer has earned off this client, gross of commission. */
  value: number;
  joinedAt: string;
  firstSessionOn: string;
  lastSessionOn: string;
  active: boolean;
}

/**
 * Folds session rows into one entry per customer.
 *
 * Done in memory rather than in SQL on purpose: `BookingSession` has no
 * `customerId` (it hangs off `Booking`), so grouping by customer in Prisma
 * would need a raw query. The row set is capped at 500 by the caller.
 *
 * `rows` must arrive newest first — the last-session date and the headline
 * service are read off the head of each customer's slice.
 */
export function foldClients(
  rows: ClientSessionRow[],
  activeFrom: Date,
): TrainerClient[] {
  const byCustomer = new Map<string, ClientSessionRow[]>();

  for (const row of rows) {
    const id = row.booking.customer.id;
    const slice = byCustomer.get(id);
    if (slice) slice.push(row);
    else byCustomer.set(id, [row]);
  }

  // Active first, then most recently seen — page 38 lists the people the
  // trainer is actually working with above the ones who have drifted off.
  //
  // Sorted on the slices, while the dates are still `Date`: comparing the
  // formatted `dd-mm-yyyy` strings would order by day-of-month.
  const slices = [...byCustomer.values()].sort(
    (a, b) => b[0].sessionDate.getTime() - a[0].sessionDate.getTime(),
  );

  const clients = slices.map(toClient(activeFrom));

  return clients.sort((a, b) => Number(b.active) - Number(a.active));
}

const toClient =
  (activeFrom: Date) =>
  (slice: ClientSessionRow[]): TrainerClient => {
    const { customer } = slice[0].booking;
    const newest = slice[0];
    const oldest = slice[slice.length - 1];

    return {
      id: customer.id,
      name: shortNameOf(customer.name),
      initials: initialsOf(customer.name),
      service: commonestService(slice),
      sessions: slice.length,
      completed: slice.filter((r) => r.status === 'COMPLETED').length,
      upcoming: slice.filter((r) => r.status !== 'COMPLETED').length,
      value: slice.reduce((sum, r) => sum + money(r.sessionValue), 0),
      joinedAt: formatDate(customer.createdAt),
      firstSessionOn: formatDate(oldest.sessionDate),
      lastSessionOn: formatDate(newest.sessionDate),
      // An upcoming session counts too: a client booked for next week is
      // active however long ago the last one was.
      active: slice.some(
        (r) => r.status !== 'COMPLETED' || r.sessionDate >= activeFrom,
      ),
    };
  };

function commonestService(slice: ClientSessionRow[]): string {
  const counts = new Map<string, number>();

  for (const row of slice) {
    counts.set(row.service.name, (counts.get(row.service.name) ?? 0) + 1);
  }

  // Ties go to the most recent, which is the head of the slice.
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
