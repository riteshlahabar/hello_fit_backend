import { addCalendarDays, calendarWeekday } from '../../common/dates/calendar';
import type { PayoutPolicy } from '../settings/settings.defaults';
import type { PayoutStatus } from '../../generated/prisma/enums';

/**
 * Payout cycle dates and the payout status machine, as pure functions.
 *
 * Separate from `commission.calculator.ts` on purpose: that one answers "what
 * is this teacher owed for this session", this one answers "which sessions go
 * in this week's batch and what may finance do with it next". The money
 * arithmetic (`buildPayoutBatch`) stays over there.
 *
 * Pure because a teacher disputing a payout must be answerable from the stored
 * cycle dates and the earning list alone — and because a wrong cycle boundary
 * either pays a session twice or never pays it at all.
 */

export interface PayoutCycle {
  /** Inclusive first calendar day of the cycle. */
  from: Date;
  /** Inclusive last calendar day. */
  to: Date;
}

/**
 * The cycle that *closed* most recently on or before `asOf`.
 *
 * `payoutCycleDay` is the weekday the batch job runs (0 = Sunday), so the cycle
 * it pays is the seven days **ending the day before** — a batch run on Monday
 * pays Monday-to-Sunday just gone, never the day it runs. Including the run day
 * would pay sessions whose dispute window cannot possibly have closed yet.
 */
export function currentPayoutCycle(
  policy: PayoutPolicy,
  asOf: Date,
): PayoutCycle {
  // Days since the cycle day last came round; 0 when today *is* that day.
  const weekday = calendarWeekday(asOf);
  const sinceCycleDay = (weekday - policy.payoutCycleDay + 7) % 7;

  const to = addCalendarDays(asOf, -sinceCycleDay - 1);
  return { from: addCalendarDays(to, -6), to };
}

/**
 * The cycle a given calendar day falls inside, for the N-th previous cycle.
 * `back: 0` is the most recently closed cycle, `back: 1` the one before it.
 * Used by the admin screen to regenerate or inspect an earlier week.
 */
export function payoutCycleBack(
  policy: PayoutPolicy,
  asOf: Date,
  back: number,
): PayoutCycle {
  const current = currentPayoutCycle(policy, asOf);
  const shift = -7 * back;
  return {
    from: addCalendarDays(current.from, shift),
    to: addCalendarDays(current.to, shift),
  };
}

/** True when `asOf` is the configured batch day. */
export function isPayoutRunDay(policy: PayoutPolicy, asOf: Date): boolean {
  return calendarWeekday(asOf) === policy.payoutCycleDay;
}

// -------------------------------------------------------------- status machine

/**
 * What finance may do next with a payout.
 *
 * - `DRAFT` → `APPROVED`, or back to nothing (a draft is deleted, not cancelled)
 * - `APPROVED` → `INITIATED` (handed to the bank or the payout gateway)
 * - `INITIATED` → `PROCESSING` (gateway acknowledged) or straight to `PAID`
 *   (a manual bank transfer skips the middle state)
 * - `PROCESSING` → `PAID` or `FAILED`
 * - `FAILED` → `APPROVED`, so a corrected bank detail can be retried
 * - `PAID` is terminal. Money has left; reversing it is a new transaction, not
 *   a status change.
 */
const TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  DRAFT: ['APPROVED'],
  APPROVED: ['INITIATED'],
  INITIATED: ['PROCESSING', 'PAID', 'FAILED'],
  PROCESSING: ['PAID', 'FAILED'],
  PAID: [],
  FAILED: ['APPROVED'],
};

export function allowedPayoutTransitions(from: PayoutStatus): PayoutStatus[] {
  return TRANSITIONS[from];
}

export function canTransitionPayout(
  from: PayoutStatus,
  to: PayoutStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * A draft may still be edited or deleted; anything further has been approved by
 * finance and is an auditable commitment.
 */
export function isPayoutEditable(status: PayoutStatus): boolean {
  return status === 'DRAFT';
}

/** Terminal states, where the earnings inside are settled one way or another. */
export function isPayoutClosed(status: PayoutStatus): boolean {
  return status === 'PAID';
}

// ------------------------------------------------------------------- statement

export interface StatementLine {
  sessionId: string;
  sessionDate: Date;
  serviceName: string;
  sessionValue: number;
  commissionAmount: number;
  deductions: number;
  netAmount: number;
}

export interface PayoutStatement {
  cycle: PayoutCycle;
  lines: StatementLine[];
  sessionCount: number;
  gross: number;
  tds: number;
  tdsPercent: number;
  deductions: number;
  net: number;
}

/**
 * The statement a teacher receives, reconstructed from the stored lines rather
 * than recomputed from live settings — the TDS percentage comes from the payout
 * row, so a later change to the policy does not silently restate a settled
 * payout. The totals are re-derived from the lines so a statement that does not
 * add up is visible rather than hidden behind a stored total.
 */
export function buildStatement(input: {
  cycle: PayoutCycle;
  lines: StatementLine[];
  tds: number;
  tdsPercent: number;
}): PayoutStatement {
  const gross = round2(input.lines.reduce((sum, l) => sum + l.netAmount, 0));
  const deductions = round2(
    input.lines.reduce((sum, l) => sum + l.deductions, 0),
  );

  return {
    cycle: input.cycle,
    lines: input.lines,
    sessionCount: input.lines.length,
    gross,
    tds: input.tds,
    tdsPercent: input.tdsPercent,
    deductions,
    net: round2(Math.max(0, gross - input.tds - deductions)),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
