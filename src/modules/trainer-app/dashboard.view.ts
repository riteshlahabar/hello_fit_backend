import { formatClock, splitClock } from '../../common/dates/clock';
import { initialsOf, rupees, shortNameOf, statusLabelOf } from './trainer-view';

/** `.schedule` on page 24 — the two-line time, the service, the client. */
export function toScheduleEntry(row: {
  id: string;
  fromMinute: number;
  toMinute: number;
  durationMin: number;
  status: string;
  service: { name: string };
  booking: { customer: { name: string } };
}) {
  const { time, meridiem } = splitClock(row.fromMinute);

  return {
    sessionId: row.id,
    time,
    meridiem,
    service: row.service.name,
    clientLine: `Client: ${shortNameOf(row.booking.customer.name)} · ${row.durationMin} min`,
    status: row.status === 'COMPLETED' ? 'DONE' : statusLabelOf(row.status),
    startsAt: formatClock(row.fromMinute),
  };
}

/** `.request` on page 24 — just enough to decide whether to open page 31. */
export function toRequestPreview(row: {
  id: string;
  mode: string;
  session: {
    service: { name: string };
    booking: { customer: { name: string } };
  };
}) {
  const name = row.session.booking.customer.name;

  return {
    id: row.id,
    initials: initialsOf(name),
    title: 'New client request',
    subtitle: `From ${shortNameOf(name)} · ${row.session.service.name}`,
    mode: row.mode,
  };
}

/**
 * The four `.metrics` tiles, in the order the client's HTML lists them.
 *
 * The values and captions are built here rather than in Flutter because the
 * HTML prints them pre-composed ("2 completed · 2 upcoming") and the count
 * that drives each caption is already in hand. The fourth tile's caption on
 * the client's page reads "Illustrative dashboard amount" — now that the
 * figure is real, it names the period instead.
 */
export function metricsFor(parts: {
  schedule: Array<{ status: string }>;
  requests: unknown[];
  clients: number;
  monthNet: number;
}) {
  const done = parts.schedule.filter((s) => s.status === 'DONE').length;
  const upcoming = parts.schedule.length - done;

  return [
    {
      key: 'todaySessions',
      title: "Today's sessions",
      value: pad(parts.schedule.length),
      caption: `${done} completed · ${upcoming} upcoming`,
    },
    {
      key: 'bookingRequests',
      title: 'Booking requests',
      value: pad(parts.requests.length),
      caption:
        parts.requests.length > 0
          ? 'Waiting for your response'
          : 'Nothing waiting on you',
    },
    {
      key: 'activeClients',
      title: 'Active clients',
      value: pad(parts.clients),
      caption: 'Your current client list',
    },
    {
      key: 'monthEarnings',
      title: "This month's earnings",
      value: rupees(parts.monthNet),
      caption: 'Net of commission, last 30 days',
    },
  ];
}

/** The HTML prints `04`, not `4`. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
