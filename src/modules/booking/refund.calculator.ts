import type { RefundSlabs, ReschedulePolicy } from '../settings/settings.defaults';

/**
 * Cancellation and reschedule policy arithmetic (spec 3.5). Pure: the caller
 * supplies "now" so the boundaries are testable, and every slab comes from
 * settings rather than being written into the code.
 */

export type CancelledBy =
  | 'CUSTOMER'
  | 'INSTRUCTOR'
  | 'ADMIN'
  | 'CUSTOMER_NO_SHOW'
  | 'INSTRUCTOR_NO_SHOW';

export interface RefundInput {
  sessionValue: number;
  /** Scheduled start of the session. */
  startsAt: Date;
  now: Date;
  cancelledBy: CancelledBy;
  /** Once the teacher has checked in, no refund applies. */
  hasCheckedIn: boolean;
}

export interface RefundResult {
  /** Identifies which rule produced the amount; stored on the refund row. */
  slab: string;
  percent: number;
  amount: number;
  /** Extra wallet credit for the inconvenience, provider-fault cases only. */
  goodwillCredit: number;
  mode: 'WALLET' | 'SOURCE';
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function computeRefund(
  input: RefundInput,
  slabs: RefundSlabs,
): RefundResult {
  const { sessionValue, cancelledBy } = input;
  const hoursUntilStart =
    (input.startsAt.getTime() - input.now.getTime()) / 3_600_000;

  const build = (
    slab: string,
    percent: number,
    goodwill = 0,
  ): RefundResult => ({
    slab,
    percent,
    amount: round2((sessionValue * percent) / 100),
    goodwillCredit: goodwill,
    mode: 'WALLET',
  });

  // Provider fault always refunds in full, regardless of timing.
  if (cancelledBy === 'INSTRUCTOR' || cancelledBy === 'ADMIN') {
    return build(
      `PROVIDER_CANCEL_${cancelledBy}`,
      slabs.providerCancelPercent,
      slabs.providerCancelGoodwill,
    );
  }

  if (cancelledBy === 'INSTRUCTOR_NO_SHOW') {
    return build(
      'INSTRUCTOR_NO_SHOW',
      slabs.providerCancelPercent,
      slabs.providerCancelGoodwill,
    );
  }

  // The customer did not appear: charged per policy, so the refund is what
  // remains after the charge.
  if (cancelledBy === 'CUSTOMER_NO_SHOW') {
    return build(
      'CUSTOMER_NO_SHOW',
      Math.max(0, 100 - slabs.customerNoShowChargePercent),
    );
  }

  // Customer-initiated, timing-based.
  if (input.hasCheckedIn) {
    return build('AFTER_CHECK_IN', slabs.afterCheckInPercent);
  }

  if (hoursUntilStart >= 24) {
    return build('MORE_THAN_24H', slabs.moreThan24hPercent);
  }

  if (hoursUntilStart >= 2) {
    return build('BETWEEN_2H_AND_24H', slabs.between2And24hPercent);
  }

  return build('LESS_THAN_2H', slabs.lessThan2hPercent);
}

export type RescheduleDecision =
  | { allowed: true; chargeable: false; reason: 'FREE' }
  | { allowed: true; chargeable: true; reason: 'FREE_QUOTA_EXHAUSTED' }
  | { allowed: false; reason: 'TOO_LATE' | 'ALREADY_CHECKED_IN' };

export function evaluateReschedule(
  input: {
    startsAt: Date;
    now: Date;
    /** Reschedules already used on this session. */
    rescheduleCount: number;
    hasCheckedIn: boolean;
  },
  policy: ReschedulePolicy,
): RescheduleDecision {
  if (input.hasCheckedIn) {
    return { allowed: false, reason: 'ALREADY_CHECKED_IN' };
  }

  const hoursUntilStart =
    (input.startsAt.getTime() - input.now.getTime()) / 3_600_000;

  // Inside the blocked window a reschedule is treated as a cancellation.
  if (hoursUntilStart < policy.blockedWithinHours) {
    return { allowed: false, reason: 'TOO_LATE' };
  }

  if (hoursUntilStart >= policy.freeBeyondHours) {
    return { allowed: true, chargeable: false, reason: 'FREE' };
  }

  // Between the two windows: a limited number of free reschedules.
  return input.rescheduleCount < policy.freeRescheduleCountWithin24h
    ? { allowed: true, chargeable: false, reason: 'FREE' }
    : { allowed: true, chargeable: true, reason: 'FREE_QUOTA_EXHAUSTED' };
}

/**
 * Statuses a session can still be cancelled from. Lives here with the rest
 * of the cancellation policy so the one list serves both the act
 * (`RefundService`) and the screens that decide whether to offer the button.
 */
export const CANCELLABLE_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ASSIGNED',
  'REASSIGNMENT_NEEDED',
  'EN_ROUTE',
  'RESCHEDULE_REQUESTED',
] as const;

export type CancellableStatus = (typeof CANCELLABLE_STATUSES)[number];

/** Whether the Cancel button applies to a session in this status. */
export function isCancellable(status: string): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}
