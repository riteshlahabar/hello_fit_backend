import { DEFAULT_SETTINGS } from '../settings/settings.defaults';
import {
  quote,
  splitSessionValues,
  travelChargeFor,
} from './pricing.calculator';

const policy = DEFAULT_SETTINGS.payment;

describe('travelChargeFor', () => {
  it('is free inside the free radius', () => {
    expect(travelChargeFor(5, policy)).toBe(0);
    expect(travelChargeFor(0, policy)).toBe(0);
  });

  it('is free when distance is unknown', () => {
    expect(travelChargeFor(undefined, policy)).toBe(0);
  });

  it('applies the first slab the distance falls into', () => {
    expect(travelChargeFor(8, policy)).toBe(50);
    expect(travelChargeFor(12, policy)).toBe(100);
    expect(travelChargeFor(20, policy)).toBe(150);
  });

  it('applies the slab boundary inclusively', () => {
    expect(travelChargeFor(10, policy)).toBe(50);
  });

  it('falls back to the last slab beyond the final boundary', () => {
    expect(travelChargeFor(40, policy)).toBe(150);
  });
});

describe('quote', () => {
  it('prices a single session with tax', () => {
    const result = quote(
      { unitPrice: 600, sessionCount: 1, addons: [] },
      policy,
    );

    expect(result.grossAmount).toBe(600);
    expect(result.tax).toBe(108); // 18% of 600
    expect(result.payable).toBe(708);
  });

  it('multiplies by session count for a package', () => {
    const result = quote(
      { unitPrice: 500, sessionCount: 12, addons: [] },
      policy,
    );

    expect(result.grossAmount).toBe(6000);
    expect(result.payable).toBe(7080);
  });

  it('charges travel per visit, not per booking', () => {
    const result = quote(
      { unitPrice: 500, sessionCount: 4, addons: [], distanceKm: 8 },
      policy,
    );

    expect(result.travelCharge).toBe(200); // 50 x 4 sessions
  });

  it('totals add-on quantities', () => {
    const result = quote(
      {
        unitPrice: 500,
        sessionCount: 1,
        addons: [
          { addonId: 'a', quantity: 2, unitPrice: 100 },
          { addonId: 'b', quantity: 1, unitPrice: 50 },
        ],
      },
      policy,
    );

    expect(result.addonAmount).toBe(250);
  });

  it('taxes after the discount, not before', () => {
    const result = quote(
      { unitPrice: 1000, sessionCount: 1, addons: [], discount: 200 },
      policy,
    );

    expect(result.taxableValue).toBe(800);
    expect(result.tax).toBe(144); // 18% of 800, not of 1000
  });

  it('never lets a discount exceed the charge', () => {
    const result = quote(
      { unitPrice: 500, sessionCount: 1, addons: [], discount: 9999 },
      policy,
    );

    expect(result.discount).toBe(500);
    expect(result.payable).toBe(0);
  });

  it('applies wallet after tax and never below zero', () => {
    const result = quote(
      { unitPrice: 600, sessionCount: 1, addons: [], walletApplied: 9999 },
      policy,
    );

    expect(result.walletApplied).toBe(708);
    expect(result.payable).toBe(0);
  });

  it('multiplies by head count — the rate is per person', () => {
    const result = quote(
      { unitPrice: 600, sessionCount: 2, participantCount: 3, addons: [] },
      policy,
    );

    expect(result.baseAmount).toBe(3600);
    expect(result.grossAmount).toBe(3600);
  });

  it('marks up on a positive percent and discounts on a negative one', () => {
    const trial = quote(
      { unitPrice: 600, sessionCount: 1, percentAdjust: 20, addons: [] },
      policy,
    );
    const intensive = quote(
      { unitPrice: 600, sessionCount: 10, percentAdjust: -15, addons: [] },
      policy,
    );

    expect(trial.percentAmount).toBe(120);
    expect(trial.grossAmount).toBe(720);
    expect(intensive.percentAmount).toBe(-900);
    expect(intensive.grossAmount).toBe(5100);
  });

  it('applies the percent to the head-count gross, not the unit rate', () => {
    const result = quote(
      {
        unitPrice: 600,
        sessionCount: 1,
        participantCount: 5,
        percentAdjust: -30,
        addons: [],
      },
      policy,
    );

    expect(result.baseAmount).toBe(3000);
    expect(result.grossAmount).toBe(2100);
  });

  it('does not drift on prices that are awkward in binary floating point', () => {
    const result = quote(
      { unitPrice: 0.1, sessionCount: 3, addons: [] },
      policy,
    );

    // 0.1 x 3 is 0.30000000000000004 in float arithmetic.
    expect(result.grossAmount).toBe(0.3);
  });

  it('rejects impossible inputs', () => {
    expect(() =>
      quote({ unitPrice: 500, sessionCount: 0, addons: [] }, policy),
    ).toThrow('sessionCount must be at least 1');

    expect(() =>
      quote({ unitPrice: -1, sessionCount: 1, addons: [] }, policy),
    ).toThrow('unitPrice cannot be negative');

    expect(() =>
      quote(
        { unitPrice: 500, sessionCount: 1, participantCount: 0, addons: [] },
        policy,
      ),
    ).toThrow('participantCount must be at least 1');

    expect(() =>
      quote(
        { unitPrice: 500, sessionCount: 1, percentAdjust: -120, addons: [] },
        policy,
      ),
    ).toThrow('percentAdjust cannot be below -100');
  });
});

describe('splitSessionValues', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(splitSessionValues(600, 3)).toEqual([200, 200, 200]);
  });

  it('appends free sessions at zero', () => {
    expect(splitSessionValues(600, 1, 1)).toEqual([600, 0]);
  });

  it('puts the rounding remainder on the first session and still sums exactly', () => {
    const parts = splitSessionValues(100, 3);
    const total = parts.reduce((a, b) => a + b, 0);

    expect(total).toBe(100);
    expect(parts[0]).toBeGreaterThan(parts[1]);
  });
});
