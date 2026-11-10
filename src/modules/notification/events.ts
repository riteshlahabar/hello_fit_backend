import type {
  NotificationAudience,
  NotificationChannel,
} from '../../generated/prisma/enums';

/**
 * The spec's chapter-9 notification matrix, as data.
 *
 * Every row of that table becomes one entry here: which audiences hear about an
 * event, and on which channels. Domain code calls
 * `notifications.emit('booking.confirmed', …)` and this decides the fan-out —
 * so adding SMS to an event is a one-line change in one file, and the matrix
 * can be diffed against the spec rather than hunted for across modules.
 *
 * Deliberately a constant and not a database table. The *copy* is
 * admin-editable (`NotificationTemplate`); the *routing* is a product decision
 * the spec fixes, and letting ops silently stop sending "teacher assigned" is
 * not a feature anyone asked for.
 */

/** Channels for one audience on one event. */
export type ChannelSet = NotificationChannel[];

export interface EventDefinition {
  /** Human description, used in the admin template editor. */
  description: string;
  /**
   * Transactional events ignore user channel preferences: a customer cannot opt
   * out of being told their teacher is at the door. Only `promotional: true`
   * events are suppressible.
   */
  promotional?: boolean;
  /**
   * Push priority. `high` wakes a dozing device immediately — reserved for the
   * offer countdown and the arrival strip, because Android throttles senders
   * who overuse it.
   */
  priority?: 'normal' | 'high';
  /** Placeholders the templates for this event may reference. */
  variables: string[];
  customer?: ChannelSet;
  instructor?: ChannelSet;
  admin?: ChannelSet;
}

const PUSH: ChannelSet = ['PUSH'];
const PUSH_IN_APP: ChannelSet = ['PUSH', 'IN_APP'];
const IN_APP: ChannelSet = ['IN_APP'];
const PUSH_SMS: ChannelSet = ['PUSH', 'SMS'];
const PUSH_SMS_EMAIL: ChannelSet = ['PUSH', 'SMS', 'EMAIL'];

/**
 * Keys are `domain.event`, past tense. **Never rename one** — templates,
 * preferences and outbox history all reference the string.
 */
export const NOTIFICATION_EVENTS = {
  // --------------------------------------------------------------- auth
  // OTP is sent synchronously by the auth module (the user is waiting on it),
  // so it is not routed through the outbox. Listed for completeness.

  // ------------------------------------------------------------ booking
  'booking.created_payment_pending': {
    description: 'Booking created, payment still pending',
    variables: ['bookingCode', 'payable', 'holdMinutes'],
    customer: PUSH_IN_APP,
  },
  'booking.confirmed': {
    description: 'Payment succeeded and the booking is confirmed',
    variables: ['bookingCode', 'sessionDate', 'fromTime', 'invoiceNo'],
    customer: PUSH_SMS_EMAIL,
    admin: IN_APP,
  },
  'booking.payment_failed': {
    description: 'Payment failed or the slot hold expired',
    variables: ['bookingCode', 'reason'],
    customer: PUSH_SMS,
    admin: IN_APP,
  },

  // --------------------------------------------------------- assignment
  'offer.created': {
    description: 'A session offer the teacher must accept before it cascades',
    priority: 'high',
    variables: ['areaName', 'sessionDate', 'fromTime', 'toTime', 'expiresInMin'],
    instructor: PUSH,
  },
  'assignment.confirmed': {
    description: 'A teacher has been assigned to the session',
    variables: ['instructorName', 'sessionDate', 'fromTime'],
    customer: PUSH_SMS,
    instructor: PUSH,
    admin: IN_APP,
  },
  'assignment.cascade_exhausted': {
    description: 'Nobody accepted; the session is in the admin queue',
    variables: ['bookingCode', 'sessionDate', 'fromTime', 'attempts'],
    admin: ['PUSH', 'IN_APP', 'EMAIL'],
  },

  // ------------------------------------------------------- session day
  'session.reminder_24h': {
    description: 'Reminder 24 hours before the session',
    variables: ['sessionDate', 'fromTime', 'instructorName'],
    customer: PUSH,
    instructor: PUSH,
  },
  'session.reminder_2h': {
    description: 'Reminder 2 hours before — the only reminder that also texts',
    variables: ['sessionDate', 'fromTime', 'instructorName'],
    customer: PUSH_SMS,
    instructor: PUSH_SMS,
  },
  'session.reminder_30m': {
    description: 'Reminder 30 minutes before',
    variables: ['fromTime'],
    customer: PUSH,
    instructor: PUSH,
  },
  'session.travel_started': {
    description: 'Teacher is on the way',
    priority: 'high',
    variables: ['instructorName', 'etaMinutes'],
    customer: PUSH_IN_APP,
    admin: IN_APP,
  },
  'session.checked_in': {
    description: 'Teacher checked in at the door',
    variables: ['instructorName', 'checkInAt'],
    customer: PUSH,
    instructor: IN_APP,
    admin: IN_APP,
  },
  'session.check_in_late': {
    description: 'Check-in is late or has not happened',
    priority: 'high',
    variables: ['instructorName', 'fromTime', 'minutesLate'],
    customer: PUSH,
    instructor: PUSH,
    admin: PUSH_IN_APP,
  },
  'session.completed': {
    description: 'Session completed; the teacher also sees the earning',
    variables: ['sessionDate', 'serviceName', 'earning'],
    customer: ['PUSH', 'EMAIL'],
    instructor: PUSH,
  },
  'session.rescheduled': {
    description: 'Reschedule requested, approved or rejected',
    variables: ['bookingCode', 'oldDate', 'newDate', 'newFromTime', 'outcome'],
    customer: PUSH_SMS,
    instructor: PUSH,
    admin: IN_APP,
  },
  'session.cancelled': {
    description: 'Cancellation by any party',
    variables: ['bookingCode', 'sessionDate', 'cancelledBy', 'refundAmount'],
    customer: PUSH_SMS_EMAIL,
    instructor: PUSH,
    admin: IN_APP,
  },

  // -------------------------------------------------------------- money
  'refund.initiated': {
    description: 'Refund initiated',
    variables: ['bookingCode', 'amount', 'mode'],
    customer: PUSH_SMS_EMAIL,
    admin: IN_APP,
  },
  'refund.completed': {
    description: 'Refund settled',
    variables: ['bookingCode', 'amount', 'mode'],
    customer: PUSH_SMS_EMAIL,
    admin: IN_APP,
  },
  'wallet.credited': {
    description: 'Wallet credited',
    variables: ['amount', 'balance', 'reason'],
    customer: PUSH,
  },
  'payout.paid': {
    description: 'Weekly payout settled',
    variables: ['cycleFrom', 'cycleTo', 'net', 'utr'],
    instructor: PUSH_SMS,
  },
  'payout.failed': {
    description: 'Payout transfer failed',
    variables: ['cycleFrom', 'cycleTo', 'reason'],
    instructor: PUSH_SMS,
    admin: IN_APP,
  },

  // ------------------------------------------------------------ reviews
  'review.requested': {
    description: 'Both sides are asked for a review',
    variables: ['sessionDate', 'counterpartyName'],
    customer: PUSH_IN_APP,
    instructor: PUSH_IN_APP,
  },
  'review.published': {
    description: 'The double-blind window closed and reviews are visible',
    variables: ['sessionDate', 'rating'],
    customer: PUSH,
    instructor: PUSH,
  },
  'review.low_rating': {
    description: 'A rating below 3 stars was received',
    variables: ['rating', 'sessionDate', 'instructorName'],
    instructor: PUSH,
    admin: ['PUSH', 'EMAIL'],
  },
  'review.flagged': {
    description: 'A review was auto-flagged or reported',
    variables: ['reason'],
    customer: IN_APP,
    instructor: IN_APP,
    admin: PUSH_IN_APP,
  },

  // ------------------------------------------------------- onboarding
  'onboarding.stage_changed': {
    description: 'Application moved to a new stage',
    variables: ['stage', 'reason'],
    instructor: PUSH_SMS,
    admin: IN_APP,
  },
  'document.verified': {
    description: 'A KYC document was verified',
    variables: ['docType'],
    instructor: PUSH_SMS_EMAIL,
    admin: IN_APP,
  },
  'document.rejected': {
    description: 'A KYC document was rejected and must be replaced',
    variables: ['docType', 'remarks'],
    instructor: PUSH_SMS_EMAIL,
    admin: IN_APP,
  },
  'document.expiring': {
    description: 'A document expires soon',
    variables: ['docType', 'expiryDate', 'daysLeft'],
    instructor: PUSH_SMS_EMAIL,
    admin: IN_APP,
  },
  'leave.decided': {
    description: 'Leave approved or rejected',
    variables: ['fromDate', 'toDate', 'outcome'],
    instructor: PUSH,
  },

  // ------------------------------------------------------------ growth
  'membership.expiring': {
    description: 'Membership expiring, renewed or renewal failed',
    variables: ['planName', 'expiresOn', 'outcome'],
    customer: PUSH_SMS_EMAIL,
    admin: IN_APP,
  },
  'campaign.broadcast': {
    description: 'Coupon, offer or campaign — the only promotional event',
    promotional: true,
    variables: ['title', 'message', 'couponCode'],
    customer: ['PUSH', 'EMAIL'],
  },
} as const satisfies Record<string, EventDefinition>;

export type NotificationEventKey = keyof typeof NOTIFICATION_EVENTS;

export function eventDefinition(key: string): EventDefinition | undefined {
  return (NOTIFICATION_EVENTS as Record<string, EventDefinition>)[key];
}

/** The channels this audience should receive for this event, or `[]`. */
export function channelsFor(
  key: string,
  audience: NotificationAudience,
): ChannelSet {
  const def = eventDefinition(key);
  if (!def) return [];
  switch (audience) {
    case 'CUSTOMER':
      return def.customer ?? [];
    case 'INSTRUCTOR':
      return def.instructor ?? [];
    case 'ADMIN':
      return def.admin ?? [];
    default:
      return [];
  }
}

/** Only promotional events may be opted out of. */
export function isSuppressible(key: string): boolean {
  return eventDefinition(key)?.promotional === true;
}

export function pushPriority(key: string): 'normal' | 'high' {
  return eventDefinition(key)?.priority ?? 'normal';
}

export const ALL_EVENT_KEYS = Object.keys(
  NOTIFICATION_EVENTS,
) as NotificationEventKey[];

/**
 * The catalogue, widened to `EventDefinition`.
 *
 * `as const satisfies` keeps each literal narrow, which is what makes the keys
 * and channel tuples precise — but it also means a field absent from one entry
 * does not exist on the union, so `def.promotional` fails to type-check when
 * iterating. This widens once, here, rather than casting at every call site.
 */
export function listEventDefinitions(): Array<
  { eventKey: string } & EventDefinition
> {
  return Object.entries(NOTIFICATION_EVENTS as Record<string, EventDefinition>)
    .map(([eventKey, def]) => ({ eventKey, ...def }));
}

/** `*` in a preference row means "every event on this channel". */
export const ALL_EVENTS_SENTINEL = '*';
