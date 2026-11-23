import { formatDate } from '../../common/dates/format';
import { formatClock, formatClockRange, splitClock } from '../../common/dates/clock';

/** `Aditi Kulkarni` → `AK`. The avatar on nearly every trainer screen. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';

  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';

  return (first + last).toUpperCase();
}

/** `Priya Sharma` → `Priya S.` — the masked form the HTML cards show. */
export function shortNameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Client';
  if (parts.length === 1) return parts[0];

  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Decimal columns come back as Prisma Decimal; the wire wants a number. */
export function money(value: unknown): number {
  return Number(value ?? 0);
}

/** `₹8,400` — the metric tiles and amount rows print it pre-formatted. */
export function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** The one slot shape every trainer screen reuses. */
export function slotOf(row: {
  sessionDate: Date;
  fromMinute: number;
  toMinute: number;
  durationMin: number;
}) {
  const { time, meridiem } = splitClock(row.fromMinute);

  return {
    date: formatDate(row.sessionDate),
    time: formatClock(row.fromMinute),
    clock: time,
    meridiem,
    range: formatClockRange(row.fromMinute, row.toMinute),
    durationMin: row.durationMin,
  };
}

/**
 * `SessionStatus` → the pill the client's HTML draws. Four buckets, because
 * pages 30 and 37 filter on exactly those: Confirmed, Pending, Completed,
 * Cancelled.
 *
 * **`CONFIRMED` is confirmed here, not pending** (client, 23-11-2026). It sat
 * in `pending` until then, reasoning that the trainer had not accepted yet
 * (§4.7) — but the status is reached by the payment settling, so the money is
 * taken and the customer, the website and the admin table all call that
 * booking confirmed. A pill reading PENDING on the trainer's own screen
 * contradicted all three.
 *
 * What the trainer still owes an answer on is the *offer*, not the session:
 * that is page 31, which reads `assignment.response = 'PENDING'` and is
 * untouched by this bucket map. A session whose offer is unanswered therefore
 * shows as CONFIRMED in Bookings while sitting in the Requests inbox — the
 * detail screen's accept/reject strip keys off `request.response`, not the
 * bucket, so it still appears.
 */
export const BOOKING_BUCKETS = {
  pending: ['RESCHEDULE_REQUESTED'],
  confirmed: ['CONFIRMED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'],
  completed: ['COMPLETED'],
  cancelled: [
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_TEACHER',
    'CANCELLED_BY_ADMIN',
    'NO_SHOW_CUSTOMER',
    'NO_SHOW_TEACHER',
    'REASSIGNMENT_NEEDED',
  ],
} as const;

export type BookingBucket = keyof typeof BOOKING_BUCKETS;

/** Which bucket a status falls in. Anything unrecognised reads as cancelled. */
export function bucketOf(status: string): BookingBucket {
  for (const [bucket, members] of Object.entries(BOOKING_BUCKETS)) {
    if ((members as readonly string[]).includes(status)) {
      return bucket as BookingBucket;
    }
  }
  return 'cancelled';
}

/**
 * The two in-flight statuses that print their own words — everything else
 * prints its bucket, so `ASSIGNED` and `CONFIRMED` both read `CONFIRMED`.
 */
const OWN_WORDS = new Set(['EN_ROUTE', 'IN_PROGRESS']);

/** The word on the pill: `ASSIGNED` → `CONFIRMED`, `EN_ROUTE` → `EN ROUTE`. */
export function statusLabelOf(status: string): string {
  return OWN_WORDS.has(status)
    ? status.replace(/_/g, ' ')
    : bucketOf(status).toUpperCase();
}

/**
 * Page 32's **Completed** button (client, 23-11-2026). The trainer closes
 * the booking himself with the 4-digit code the customer reads off their own
 * app; the act and the reasoning are in `session-actions.service.ts`.
 *
 * `NO_SHOW_TEACHER` is in the list because the auto no-show cron flags any
 * session that was never checked in, and under this flow a check-in never
 * happens — a valid customer code disproves the flag.
 */
export const COMPLETABLE_STATUSES = [
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'NO_SHOW_TEACHER',
] as const;

/** Whether page 32 offers the Completed button for a session in this status. */
export function isCompletableByTrainer(status: string): boolean {
  return (COMPLETABLE_STATUSES as readonly string[]).includes(status);
}
