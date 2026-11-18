import type { PayoutPolicy } from '../settings/settings.defaults';

/**
 * Commission and earning arithmetic (spec 3.7). Pure, because this is the
 * calculation a teacher will dispute: it must be reproducible from the stored
 * rule and the session value alone.
 */

export type CommissionScopeName =
  | 'GLOBAL'
  | 'CATEGORY'
  | 'SERVICE'
  | 'TRAINER_CATEGORY'
  | 'INSTRUCTOR';

export interface CommissionRuleLike {
  id: string;
  scope: CommissionScopeName;
  categoryId?: string | null;
  serviceId?: string | null;
  trainerCategoryId?: string | null;
  instructorId?: string | null;
  type: 'PERCENT' | 'FLAT';
  value: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  isActive: boolean;
}

export interface CommissionContext {
  instructorId: string;
  serviceId: string;
  categoryId: string;
  /** The provider's band — Basic / Standard / Premium / Elite. Null when unset. */
  trainerCategoryId: string | null;
  /** Session date, so a rule change does not retroactively alter old earnings. */
  on: Date;
}

/**
 * Specificity order: instructor, then the provider's band, then service, then
 * service category, then global.
 *
 * TRAINER_CATEGORY sits second because it is the normal place to set a rate
 * (client, 17 Nov 2026) — one row covers every provider in the band — while an
 * INSTRUCTOR row stays above it as the per-provider override for a special deal.
 */
const SCOPE_PRIORITY: Record<CommissionScopeName, number> = {
  INSTRUCTOR: 0,
  TRAINER_CATEGORY: 1,
  SERVICE: 2,
  CATEGORY: 3,
  GLOBAL: 4,
};

/**
 * Picks the first matching rule by specificity. Within one scope the most
 * recently effective rule wins, so scheduling a future rate change is simply
 * inserting a row with a later effectiveFrom.
 */
export function resolveCommissionRule(
  rules: CommissionRuleLike[],
  context: CommissionContext,
): CommissionRuleLike | null {
  const applicable = rules.filter((rule) => {
    if (!rule.isActive) return false;
    if (rule.effectiveFrom > context.on) return false;
    if (rule.effectiveTo && rule.effectiveTo < context.on) return false;

    switch (rule.scope) {
      case 'INSTRUCTOR':
        return rule.instructorId === context.instructorId;
      case 'TRAINER_CATEGORY':
        return (
          context.trainerCategoryId !== null &&
          rule.trainerCategoryId === context.trainerCategoryId
        );
      case 'SERVICE':
        return rule.serviceId === context.serviceId;
      case 'CATEGORY':
        return rule.categoryId === context.categoryId;
      case 'GLOBAL':
        return true;
    }
  });

  if (applicable.length === 0) return null;

  return applicable.sort(
    (a, b) =>
      SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope] ||
      b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
  )[0];
}

export interface EarningBreakup {
  sessionValue: number;
  commissionAmount: number;
  deductions: number;
  netAmount: number;
  commissionRuleId: string | null;
  /** When this earning leaves PENDING and becomes payable. */
  payableFrom: Date;
}

/**
 * Builds the earning row for a completed session. Commission is capped at the
 * session value so a misconfigured flat rule can never produce a negative
 * payable.
 */
export function computeEarning(
  input: {
    sessionValue: number;
    completedAt: Date;
    deductions?: number;
  },
  rule: CommissionRuleLike | null,
  policy: PayoutPolicy,
): EarningBreakup {
  const commissionRaw = rule
    ? rule.type === 'PERCENT'
      ? (input.sessionValue * rule.value) / 100
      : rule.value
    : (input.sessionValue * policy.defaultCommissionPercent) / 100;

  const commissionAmount = round2(
    Math.min(Math.max(commissionRaw, 0), input.sessionValue),
  );
  const deductions = round2(input.deductions ?? 0);
  const netAmount = round2(
    Math.max(0, input.sessionValue - commissionAmount - deductions),
  );

  return {
    sessionValue: round2(input.sessionValue),
    commissionAmount,
    deductions,
    netAmount,
    commissionRuleId: rule?.id ?? null,
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

const round2 = (value: number): number => Math.round(value * 100) / 100;
