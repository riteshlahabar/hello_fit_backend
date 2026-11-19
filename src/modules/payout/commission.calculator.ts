import type { PayoutPolicy } from '../settings/settings.defaults';

/**
 * Commission and earning arithmetic (spec 3.7). Pure, because this is the
 * calculation a teacher will dispute: it must be reproducible from the stored
 * percentages and the session value alone.
 *
 * Commission stopped being a rule table on 19 Nov 2026 (client). It is now two
 * columns: `Service.commissionPct`, compulsory on every service, and
 * `InstructorProfile.commissionPct`, an optional per-provider override. The
 * `commission_rules` table still exists but nothing reads it.
 */

export type CommissionSourceName = 'INSTRUCTOR' | 'SERVICE';

export interface CommissionInput {
  /** The provider's own percent, or null to use the service's. */
  instructorPct: number | null;
  /** Compulsory on every service, so there is always a percent to fall to. */
  servicePct: number;
}

export interface ResolvedCommission {
  percent: number;
  source: CommissionSourceName;
}

/**
 * The provider's percent wins when it is set; otherwise the service's.
 *
 * A negative or absurd percent is clamped to 0–100 here rather than at the
 * call site, so a bad row can never produce a negative payable.
 */
export function resolveCommissionPercent(
  input: CommissionInput,
): ResolvedCommission {
  const hasOverride =
    input.instructorPct !== null && Number.isFinite(input.instructorPct);

  return hasOverride
    ? { percent: clampPercent(input.instructorPct as number), source: 'INSTRUCTOR' }
    : { percent: clampPercent(input.servicePct), source: 'SERVICE' };
}

export interface EarningBreakup {
  sessionValue: number;
  commissionAmount: number;
  commissionPercent: number;
  commissionSource: CommissionSourceName;
  deductions: number;
  netAmount: number;
  /** When this earning leaves PENDING and becomes payable. */
  payableFrom: Date;
}

/**
 * Builds the earning row for a completed session. Commission is capped at the
 * session value so a misconfigured percent can never produce a negative
 * payable.
 */
export function computeEarning(
  input: {
    sessionValue: number;
    completedAt: Date;
    deductions?: number;
  },
  commission: ResolvedCommission,
  policy: PayoutPolicy,
): EarningBreakup {
  const commissionAmount = round2(
    Math.min(
      Math.max((input.sessionValue * commission.percent) / 100, 0),
      input.sessionValue,
    ),
  );
  const deductions = round2(input.deductions ?? 0);
  const netAmount = round2(
    Math.max(0, input.sessionValue - commissionAmount - deductions),
  );

  return {
    sessionValue: round2(input.sessionValue),
    commissionAmount,
    commissionPercent: commission.percent,
    commissionSource: commission.source,
    deductions,
    netAmount,
    payableFrom: new Date(
      input.completedAt.getTime() + policy.disputeWindowHours * 3_600_000,
    ),
  };
}

export interface PayoutBatch {
  gross: number;
  tds: number;
  deductions: number;
  net: number;
  earningIds: string[];
  /** False when the total is under the minimum and the batch should not run. */
  meetsMinimum: boolean;
}

/** Totals a set of payable earnings into one payout batch. */
export function buildPayoutBatch(
  earnings: Array<{ id: string; netAmount: number; deductions?: number }>,
  policy: PayoutPolicy,
): PayoutBatch {
  const gross = round2(
    earnings.reduce((sum, earning) => sum + earning.netAmount, 0),
  );
  const deductions = round2(
    earnings.reduce((sum, earning) => sum + (earning.deductions ?? 0), 0),
  );
  const tds = round2((gross * policy.tdsPercent) / 100);
  const net = round2(Math.max(0, gross - tds - deductions));

  return {
    gross,
    tds,
    deductions,
    net,
    earningIds: earnings.map((earning) => earning.id),
    meetsMinimum: net >= policy.minimumPayoutAmount,
  };
}

const clampPercent = (value: number): number =>
  Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100);

const round2 = (value: number): number => Math.round(value * 100) / 100;
