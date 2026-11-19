import { DEFAULT_SETTINGS } from '../settings/settings.defaults';
import {
  buildPayoutBatch,
  computeEarning,
  resolveCommissionPercent,
} from './commission.calculator';

const policy = DEFAULT_SETTINGS.payout;

describe('resolveCommissionPercent — the provider overrides the service', () => {
  it('uses the service percent when the provider has none', () => {
    expect(
      resolveCommissionPercent({ instructorPct: null, servicePct: 25 }),
    ).toEqual({ percent: 25, source: 'SERVICE' });
  });

  it('uses the provider percent when it is set', () => {
    expect(
      resolveCommissionPercent({ instructorPct: 40, servicePct: 25 }),
    ).toEqual({ percent: 40, source: 'INSTRUCTOR' });
  });

  it('treats a provider percent of zero as a real override, not absence', () => {
    expect(
      resolveCommissionPercent({ instructorPct: 0, servicePct: 25 }),
    ).toEqual({ percent: 0, source: 'INSTRUCTOR' });
  });

  it('clamps a percent above 100', () => {
    expect(
      resolveCommissionPercent({ instructorPct: 250, servicePct: 25 }).percent,
    ).toBe(100);
  });

  it('clamps a negative percent to zero', () => {
    expect(
      resolveCommissionPercent({ instructorPct: null, servicePct: -5 }).percent,
    ).toBe(0);
  });
});

describe('computeEarning', () => {
  const completedAt = new Date('2026-11-01T10:00:00Z');
  const at = (percent: number, source: 'SERVICE' | 'INSTRUCTOR' = 'SERVICE') =>
    ({ percent, source }) as const;

  it('takes the commission as a percentage of the session value', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      at(25),
      policy,
    );

    expect(result.commissionAmount).toBe(250);
    expect(result.netAmount).toBe(750);
  });

  it('subtracts deductions from the net', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt, deductions: 100 },
      at(25),
      policy,
    );

    expect(result.netAmount).toBe(650);
  });

  it('pays the whole session value out when commission is zero', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      at(0, 'INSTRUCTOR'),
      policy,
    );

    expect(result.commissionAmount).toBe(0);
    expect(result.netAmount).toBe(1000);
  });

  it('never produces a negative net', () => {
    const result = computeEarning(
      { sessionValue: 500, completedAt },
      at(100),
      policy,
    );

    expect(result.commissionAmount).toBe(500);
    expect(result.netAmount).toBe(0);
  });

  it('rounds to two places rather than carrying fractions of a paisa', () => {
    const result = computeEarning(
      { sessionValue: 999.99, completedAt },
      at(12.5),
      policy,
    );

    expect(result.commissionAmount).toBe(125);
    expect(result.netAmount).toBe(874.99);
  });

  it('sets payableFrom to the end of the dispute window', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      at(25),
      policy,
    );

    // Default dispute window is 48 hours.
    expect(result.payableFrom.toISOString()).toBe('2026-11-03T10:00:00.000Z');
  });

  it('records the percent and where it came from, so the basis can be shown', () => {
    const result = computeEarning(
      { sessionValue: 1000, completedAt },
      at(40, 'INSTRUCTOR'),
      policy,
    );

    expect(result.commissionPercent).toBe(40);
    expect(result.commissionSource).toBe('INSTRUCTOR');
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
