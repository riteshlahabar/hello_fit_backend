import type { PaymentPolicy } from '../settings/settings.defaults';

/**
 * Pure pricing arithmetic (spec 3.1 step 9, client pricing doc 17 Nov 2026):
 *
 *   gross = basePrice x participants x sessions, then ONE percent
 *   payable = gross + add-ons + travel - discount + tax - wallet
 *
 * The percent is either the package's `percentAdjust` or the group slab's
 * `percentOff`, never both: `Service.allowMultiPerson` decides which system a
 * service uses, so the caller resolves a single signed figure and passes it
 * here. See `state/pricing-rules.md`.
 *
 * Money is handled in paise as integers throughout, then converted once at
 * the edge. Floating-point rupees drift: 0.1 + 0.2 !== 0.3, and a few paise
 * of drift per session becomes a reconciliation mismatch at month end.
 */

export interface AddonLine {
  addonId: string;
  quantity: number;
  unitPrice: number;
}

export interface QuoteInput {
  /** Per session, per person. Always `Service.basePrice` — admin-set. */
  unitPrice: number;
  sessionCount: number;
  /** People attending each session. Defaults to 1. */
  participantCount?: number;
  /**
   * Signed percent on the gross: +20 marks up (the trial), -15 discounts (the
   * 90-day intensive), 0 leaves it alone. Exactly one source — package or
   * group slab — ever supplies it.
   */
  percentAdjust?: number;
  addons: AddonLine[];
  /** Straight-line distance from the teacher base to the address. */
  distanceKm?: number;
  /** Absolute discount from a coupon. */
  discount?: number;
  /** Wallet amount the customer chose to apply. */
  walletApplied?: number;
}

export interface QuoteBreakup {
  unitPrice: number;
  sessionCount: number;
  participantCount: number;
  /** Before the percent: unitPrice x participants x sessions. */
  baseAmount: number;
  percentAdjust: number;
  /** Signed rupee effect of the percent, for the breakup line. */
  percentAmount: number;
  grossAmount: number;
  addonAmount: number;
  travelCharge: number;
  discount: number;
  taxableValue: number;
  tax: number;
  walletApplied: number;
  payable: number;
  /** Per-session value, used to create the earning row on completion. */
  sessionValue: number;
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);
const toRupees = (paise: number): number => Math.round(paise) / 100;

/**
 * Travel charge from the distance slabs. Inside the free radius it is zero;
 * beyond the last slab the last slab applies rather than refusing the booking
 * (the hard limit is enforced by the matching engine, not pricing).
 */
export function travelChargeFor(
  distanceKm: number | undefined,
  policy: PaymentPolicy,
): number {
  if (distanceKm === undefined || distanceKm <= policy.freeTravelRadiusKm) {
    return 0;
  }

  const slabs = [...policy.travelSlabs].sort((a, b) => a.uptoKm - b.uptoKm);
  const match = slabs.find((slab) => distanceKm <= slab.uptoKm);

  return match ? match.charge : (slabs.at(-1)?.charge ?? 0);
}

export function quote(input: QuoteInput, policy: PaymentPolicy): QuoteBreakup {
  const participants = input.participantCount ?? 1;
  const percent = input.percentAdjust ?? 0;

  if (input.sessionCount < 1) {
    throw new Error('sessionCount must be at least 1');
  }
  if (participants < 1) {
    throw new Error('participantCount must be at least 1');
  }
  if (input.unitPrice < 0) {
    throw new Error('unitPrice cannot be negative');
  }
  // -100% is free; below that the booking would owe the customer money.
  if (percent < -100) {
    throw new Error('percentAdjust cannot be below -100');
  }

  const basePaise = toPaise(input.unitPrice) * participants * input.sessionCount;
  const percentPaise = Math.round((basePaise * percent) / 100);
  const grossPaise = basePaise + percentPaise;

  const addonPaise = input.addons.reduce((sum, line) => {
    if (line.quantity < 0 || line.unitPrice < 0) {
      throw new Error('add-on quantity and price cannot be negative');
    }
    return sum + toPaise(line.unitPrice) * line.quantity;
  }, 0);

  // Travel is charged per visit, not per booking.
  const travelPaise =
    toPaise(travelChargeFor(input.distanceKm, policy)) * input.sessionCount;

  // A discount can never exceed what is being charged.
  const discountPaise = Math.min(
    toPaise(input.discount ?? 0),
    grossPaise + addonPaise + travelPaise,
  );

  const taxablePaise = grossPaise + addonPaise + travelPaise - discountPaise;
  const taxPaise = Math.round((taxablePaise * policy.taxPercent) / 100);
  const totalPaise = taxablePaise + taxPaise;

  // Wallet applies after tax and cannot exceed the bill.
  const walletPaise = Math.min(toPaise(input.walletApplied ?? 0), totalPaise);
  const payablePaise = totalPaise - walletPaise;

  return {
    unitPrice: input.unitPrice,
    sessionCount: input.sessionCount,
    participantCount: participants,
    baseAmount: toRupees(basePaise),
    percentAdjust: percent,
    percentAmount: toRupees(percentPaise),
    grossAmount: toRupees(grossPaise),
    addonAmount: toRupees(addonPaise),
    travelCharge: toRupees(travelPaise),
    discount: toRupees(discountPaise),
    taxableValue: toRupees(taxablePaise),
    tax: toRupees(taxPaise),
    walletApplied: toRupees(walletPaise),
    payable: toRupees(payablePaise),
    // Divided evenly, with the rounding remainder on the first session so the
    // session values always sum back to the gross exactly.
    sessionValue: toRupees(Math.floor(grossPaise / input.sessionCount)),
  };
}

/**
 * Splits a gross amount into per-session values that sum exactly to the
 * original — the remainder goes on the first session.
 *
 * `freeCount` sessions are appended at zero: a package's free sessions are
 * delivered but not charged, and the provider is not paid for them either
 * (the trial is 1 paid + 1 free).
 */
export function splitSessionValues(
  grossAmount: number,
  sessionCount: number,
  freeCount = 0,
): number[] {
  const grossPaise = toPaise(grossAmount);
  const base = Math.floor(grossPaise / sessionCount);
  const remainder = grossPaise - base * sessionCount;

  const paid = Array.from({ length: sessionCount }, (_, index) =>
    toRupees(index === 0 ? base + remainder : base),
  );

  return [...paid, ...Array.from({ length: freeCount }, () => 0)];
}
