import type { SchedulingPolicy } from '../settings/settings.defaults';
import type { TimeBand } from './slot.calculator';

/**
 * The bands a teacher is treated as open for on one day.
 *
 * A teacher with **no weekly rule for this weekday** is treated as open
 * across the institute window rather than closed (client, 21 Nov 2026).
 *
 * Why this exists: nothing in the system writes `availability_rules` — PDF
 * §4.6 / US-P07 puts that on the provider's own app (page 67, unbuilt), and
 * there is no endpoint, admin screen or seed behind the table. So every
 * teacher had an empty rule set, `computeSlots` clipped an empty band list to
 * nothing, and the customer's time grid was empty by construction on every
 * surface. The client's answer was to let the customer choose a start time
 * and derive the end from the service duration, which is what this enables.
 *
 * It is a **fallback, not a bypass**: a teacher who has set real hours keeps
 * exactly those. And a chosen time is still re-checked against clashes,
 * approved leave and the daily cap (`isSlotStillFree`), then accepted or
 * rejected by the provider (PDF §4.7) — so an unwanted time is refused by a
 * person, not silently sold.
 */
export function openBandsFor(
  rules: TimeBand[],
  extraBands: TimeBand[],
  policy: SchedulingPolicy,
): TimeBand[] {
  if (rules.length > 0 || extraBands.length > 0) return rules;

  return [
    {
      startMinute: policy.instituteOpenMinute,
      endMinute: policy.instituteCloseMinute,
    },
  ];
}
