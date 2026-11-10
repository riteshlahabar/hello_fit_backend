import {
  allowedPayoutTransitions,
  buildStatement,
  canTransitionPayout,
  currentPayoutCycle,
  isPayoutClosed,
  isPayoutEditable,
  isPayoutRunDay,
  payoutCycleBack,
  type StatementLine,
} from './payout.calculator';
import { DEFAULT_SETTINGS } from '../settings/settings.defaults';
import { formatCalendarDate, parseCalendarDate } from '../../common/dates/calendar';
import type { PayoutPolicy } from '../settings/settings.defaults';

/** `payoutCycleDay: 1` — Monday. 2026-11-09 is a Monday. */
const policy: PayoutPolicy = { ...DEFAULT_SETTINGS.payout, payoutCycleDay: 1 };

const day = (iso: string) => parseCalendarDate(iso);
const cycleOf = (iso: string, p: PayoutPolicy = policy) => {
  const c = currentPayoutCycle(p, day(iso));
  return `${formatCalendarDate(c.from)}..${formatCalendarDate(c.to)}`;
};

describe('currentPayoutCycle', () => {
  it('pays the seven days ending the day before the run day', () => {
    // Run on Monday 9 Nov -> pays Mon 2 Nov to Sun 8 Nov.
    expect(cycleOf('2026-11-09')).toBe('2026-11-02..2026-11-08');
  });

  it('never includes the run day itself', () => {
    const c = currentPayoutCycle(policy, day('2026-11-09'));
    expect(formatCalendarDate(c.to)).not.toBe('2026-11-09');
  });

  it('holds the same cycle for every day until the next run day', () => {
    // Tue 10th through Sun 15th all still pay the 2nd-8th cycle.
    for (const d of [
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]) {
      expect(cycleOf(d)).toBe('2026-11-02..2026-11-08');
    }
  });

  it('rolls over on the next run day', () => {
    expect(cycleOf('2026-11-16')).toBe('2026-11-09..2026-11-15');
  });

  it('is always exactly seven days', () => {
    for (const d of ['2026-11-09', '2026-11-12', '2026-03-01', '2027-01-04']) {
      const c = currentPayoutCycle(policy, day(d));
      const days = Math.round((c.to.getTime() - c.from.getTime()) / 86_400_000) + 1;
      expect(days).toBe(7);
    }
  });

  it('never leaves a gap or an overlap between consecutive cycles', () => {
    const first = currentPayoutCycle(policy, day('2026-11-09'));
    const second = currentPayoutCycle(policy, day('2026-11-16'));
    // The day after the first cycle ends is the day the second begins.
    expect(second.from.getTime() - first.to.getTime()).toBe(86_400_000);
  });

  it('honours a different cycle day', () => {
    // Sunday batch. 2026-11-08 is a Sunday -> pays Sun 1 Nov to Sat 7 Nov.
    const sunday = { ...policy, payoutCycleDay: 0 };
    expect(cycleOf('2026-11-08', sunday)).toBe('2026-11-01..2026-11-07');
  });

  it('crosses a month boundary without drifting', () => {
    expect(cycleOf('2026-12-07')).toBe('2026-11-30..2026-12-06');
  });

  it('crosses a year boundary without drifting', () => {
    expect(cycleOf('2027-01-04')).toBe('2026-12-28..2027-01-03');
  });
});

describe('payoutCycleBack', () => {
  it('back: 0 is the current cycle', () => {
    const c = payoutCycleBack(policy, day('2026-11-09'), 0);
    expect(formatCalendarDate(c.from)).toBe('2026-11-02');
  });

  it('back: 1 is the week before, with no gap', () => {
    const c = payoutCycleBack(policy, day('2026-11-09'), 1);
    expect(`${formatCalendarDate(c.from)}..${formatCalendarDate(c.to)}`).toBe(
      '2026-10-26..2026-11-01',
    );
  });

  it('walks back across a year boundary', () => {
    const c = payoutCycleBack(policy, day('2027-01-04'), 2);
    expect(`${formatCalendarDate(c.from)}..${formatCalendarDate(c.to)}`).toBe(
      '2026-12-14..2026-12-20',
    );
  });
});

describe('isPayoutRunDay', () => {
  it('is true only on the configured day', () => {
    expect(isPayoutRunDay(policy, day('2026-11-09'))).toBe(true);
    expect(isPayoutRunDay(policy, day('2026-11-10'))).toBe(false);
  });
});

describe('payout status machine', () => {
  it('walks the happy path', () => {
    expect(canTransitionPayout('DRAFT', 'APPROVED')).toBe(true);
    expect(canTransitionPayout('APPROVED', 'INITIATED')).toBe(true);
    expect(canTransitionPayout('INITIATED', 'PROCESSING')).toBe(true);
    expect(canTransitionPayout('PROCESSING', 'PAID')).toBe(true);
  });

  it('lets a manual bank transfer skip PROCESSING', () => {
    expect(canTransitionPayout('INITIATED', 'PAID')).toBe(true);
  });

  it('refuses to pay without approval', () => {
    expect(canTransitionPayout('DRAFT', 'PAID')).toBe(false);
    expect(canTransitionPayout('DRAFT', 'INITIATED')).toBe(false);
  });

  it('treats PAID as terminal — money has already left', () => {
    expect(allowedPayoutTransitions('PAID')).toEqual([]);
    expect(canTransitionPayout('PAID', 'FAILED')).toBe(false);
    expect(isPayoutClosed('PAID')).toBe(true);
  });

  it('allows a failed payout to be retried after approval', () => {
    expect(canTransitionPayout('FAILED', 'APPROVED')).toBe(true);
    expect(canTransitionPayout('FAILED', 'PAID')).toBe(false);
  });

  it('only a draft is editable', () => {
    expect(isPayoutEditable('DRAFT')).toBe(true);
    for (const s of ['APPROVED', 'INITIATED', 'PROCESSING', 'PAID', 'FAILED'] as const) {
      expect(isPayoutEditable(s)).toBe(false);
    }
  });

  it('refuses a transition to the same status', () => {
    for (const s of ['DRAFT', 'APPROVED', 'INITIATED', 'PROCESSING', 'PAID', 'FAILED'] as const) {
      expect(canTransitionPayout(s, s)).toBe(false);
    }
  });
});

describe('buildStatement', () => {
  const line = (over: Partial<StatementLine> = {}): StatementLine => ({
    sessionId: 's1',
    sessionDate: day('2026-11-03'),
    serviceName: 'Hatha Yoga — 60 min',
    sessionValue: 1000,
    commissionAmount: 250,
    deductions: 0,
    netAmount: 750,
    ...over,
  });

  it('totals the lines rather than trusting a stored total', () => {
    const s = buildStatement({
      cycle: { from: day('2026-11-02'), to: day('2026-11-08') },
      lines: [line(), line({ sessionId: 's2' }), line({ sessionId: 's3' })],
      tds: 225,
      tdsPercent: 10,
    });
    expect(s.sessionCount).toBe(3);
    expect(s.gross).toBe(2250);
    expect(s.net).toBe(2025);
  });

  it('subtracts per-line deductions as well as TDS', () => {
    const s = buildStatement({
      cycle: { from: day('2026-11-02'), to: day('2026-11-08') },
      lines: [line({ deductions: 50, netAmount: 700 })],
      tds: 70,
      tdsPercent: 10,
    });
    expect(s.gross).toBe(700);
    expect(s.deductions).toBe(50);
    expect(s.net).toBe(580);
  });

  it('never goes negative, however large the deductions', () => {
    const s = buildStatement({
      cycle: { from: day('2026-11-02'), to: day('2026-11-08') },
      lines: [line({ netAmount: 100, deductions: 500 })],
      tds: 10,
      tdsPercent: 10,
    });
    expect(s.net).toBe(0);
  });

  it('carries the stored TDS percentage, not the current policy', () => {
    // A settled payout must not restate itself when the policy changes.
    const s = buildStatement({
      cycle: { from: day('2026-11-02'), to: day('2026-11-08') },
      lines: [line()],
      tds: 37.5,
      tdsPercent: 5,
    });
    expect(s.tdsPercent).toBe(5);
    expect(s.net).toBe(712.5);
  });

  it('handles an empty cycle', () => {
    const s = buildStatement({
      cycle: { from: day('2026-11-02'), to: day('2026-11-08') },
      lines: [],
      tds: 0,
      tdsPercent: 10,
    });
    expect(s).toMatchObject({ sessionCount: 0, gross: 0, net: 0 });
  });

  it('rounds to paise, not to a floating-point artefact', () => {
    const s = buildStatement({
      cycle: { from: day('2026-11-02'), to: day('2026-11-08') },
      lines: [line({ netAmount: 0.1 }), line({ sessionId: 's2', netAmount: 0.2 })],
      tds: 0,
      tdsPercent: 10,
    });
    expect(s.gross).toBe(0.3);
  });
});
