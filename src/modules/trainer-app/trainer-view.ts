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
 */
export const BOOKING_BUCKETS = {
  pending: ['CONFIRMED', 'RESCHEDULE_REQUESTED'],
  confirmed: ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'],
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

/**
 * Which bucket a status falls in. `CONFIRMED` means paid but **not yet
 * accepted by the trainer** (§4.7), which is why it reads as "pending" on the
 * trainer's own screens while the customer sees a confirmed booking.
 */
export function bucketOf(status: string): BookingBucket {
  for (const [bucket, members] of Object.entries(BOOKING_BUCKETS)) {
    if ((members as readonly string[]).includes(status)) {
      return bucket as BookingBucket;
    }
  }
  return 'cancelled';
}

/** The word on the pill: `ASSIGNED` → `CONFIRMED`, `EN_ROUTE` → `EN ROUTE`. */
export function statusLabelOf(status: string): string {
  const bucket = bucketOf(status);
  if (bucket === 'confirmed' && status !== 'ASSIGNED') {
    return status.replace(/_/g, ' ');
  }
  return bucket.toUpperCase();
}
