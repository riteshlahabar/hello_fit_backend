import { DEFAULT_SETTINGS } from '../settings/settings.defaults';
import {
  buildPayoutBatch,
  computeEarning,
  resolveCommissionRule,
  type CommissionRuleLike,
} from './commission.calculator';

const policy = DEFAULT_SETTINGS.payout;

const context = {
  instructorId: 'inst-1',
  serviceId: 'svc-1',
  categoryId: 'cat-1',
  trainerCategoryId: 'band-1',
  on: new Date('2026-11-01'),
};

const rule = (over: Partial<CommissionRuleLike>): CommissionRuleLike => ({
  id: 'r',
  scope: 'GLOBAL',
  type: 'PERCENT',
  value: 25,
  effectiveFrom: new Date('2026-01-01'),
  isActive: true,
  ...over,
});

describe('resolveCommissionRule — specificity order', () => {
  it('prefers an instructor rule over service, category and global', () => {
    const picked = resolveCommissionRule(
      [
        rule({ id: 'global' }),
        rule({ id: 'cat', scope: 'CATEGORY', categoryId: 'cat-1' }),
        rule({ id: 'svc', scope: 'SERVICE', serviceId: 'svc-1' }),
        rule({ id: 'inst', scope: 'INSTRUCTOR', instructorId: 'inst-1' }),
      ],
      context,
    );

    expect(picked?.id).toBe('inst');
  });

  it('prefers service over category', () => {
    const picked = resolveCommissionRule(
      [
        rule({ id: 'cat', scope: 'CATEGORY', categoryId: 'cat-1' }),
        rule({ id: 'svc', scope: 'SERVICE', serviceId: 'svc-1' }),
      ],
      context,
    );

    expect(picked?.id).toBe('svc');
  });

  it('falls back to global when nothing specific matches', () => {
    const picked = resolveCommissionRule(
      [
        rule({ id: 'global' }),
        rule({ id: 'other', scope: 'INSTRUCTOR', instructorId: 'someone-else' }),
      ],
      context,
    );

    expect(picked?.id).toBe('global');
  });

  it('ignores inactive rules', () => {
    const picked = resolveCommissionRule(
      [rule({ id: 'off', isActive: false })],
      context,
    );

    expect(picked).toBeNull();
  });

  it('ignores a rule not yet effective', () => {
    const picked = resolveCommissionRule(
      [rule({ id: 'future', effectiveFrom: new Date('2027-01-01') })],
      context,
    );

    expect(picked).toBeNull();
  });

  it('ignores an expired rule', () => {
    const picked = resolveCommissionRule(
      [rule({ id: 'past', effectiveTo: new Date('2026-06-01') })],
      context,
    );

    expect(picked).toBeNull();
  });

  it('within one scope, uses the most recently effective rule', () => {
    const picked = resolveCommissionRule(
      [
        rule({ id: 'old', effectiveFrom: new Date('2026-01-01') }),
        rule({ id: 'new', effectiveFrom: new Date('2026-10-01') }),
      ],
      context,
    );

    expect(picked?.id).toBe('new');
  });

  it('does not retroactively apply a rate change to an older session', () => {
    const picked = resolveCommissionRule(
      [
        rule({ id: 'old', effectiveFrom: new Date('2026-01-01') }),
        rule({ id: 'new', effectiveFrom: new Date('2026-10-01') }),
      ],
      { ...context, on: new Date('2026-05-01') },
    );

    expect(picked?.id).toBe('old');
  });
});

describe('computeEarning', () => {
  const completedAt = new Date('2026-11-01T10:00:00Z');

  it('applies a percentage rule', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      rule({ type: 'PERCENT', value: 25 }),
      policy,
    );

    expect(result.commissionAmount).toBe(250);
    expect(result.netAmount).toBe(750);
  });

  it('applies a flat rule', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      rule({ type: 'FLAT', value: 300 }),
      policy,
    );

    expect(result.commissionAmount).toBe(300);
    expect(result.netAmount).toBe(700);
  });

  it('uses the default percentage when no rule matches', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      null,
      policy,
    );

    expect(result.commissionAmount).toBe(250);
  });

  it('subtracts deductions from the net', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt, deductions: 100 },
      rule({ value: 25 }),
      policy,
    );

    expect(result.netAmount).toBe(650);
  });

  it('never produces a negative net from a misconfigured flat rule', () => {
    const result = computeEarning(
      { sessionValue: 500, completedAt },
      rule({ type: 'FLAT', value: 9999 }),
      policy,
    );

    expect(result.commissionAmount).toBe(500);
    expect(result.netAmount).toBe(0);
  });

  it('sets payableFrom to the end of the dispute window', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      null,
      policy,
    );

    // Default dispute window is 48 hours.
    expect(result.payableFrom.toISOString()).toBe('2026-11-03T10:00:00.000Z');
  });

  it('records which rule was used, so the teacher can be shown the basis', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      rule({ id: 'rule-xyz' }),
      policy,
    );

    expect(result.commissionRuleId).toBe('rule-xyz');
  });
});

describe('buildPayoutBatch', () => {
  it('totals earnings and deducts TDS', () => {
    const batch = buildPayoutBatch(
      [
        { id: 'e1', netAmount: 750 },
        { id: 'e2', netAmount: 750 },
      ],
      policy,
    );

    expect(batch.gross).toBe(1500);
    expect(batch.tds).toBe(150); // 10%
    expect(batch.net).toBe(1350);
    expect(batch.earningIds).toEqual(['e1', 'e2']);
  });

  it('flags a batch under the minimum payout amount', () => {
    const batch = buildPayoutBatch([{ id: 'e1', netAmount: 100 }], policy);

    expect(batch.meetsMinimum).toBe(false);
  });

  it('accepts a batch at or above the minimum', () => {
    const batch = buildPayoutBatch([{ id: 'e1', netAmount: 1000 }], policy);

    expect(batch.meetsMinimum).toBe(true);
  });

  it('handles an empty set without producing NaN', () => {
    const batch = buildPayoutBatch([], policy);

    expect(batch).toMatchObject({ gross: 0, tds: 0, net: 0, meetsMinimum: false });
  });
});
