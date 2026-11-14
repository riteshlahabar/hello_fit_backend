import type { Plan, PlanFeature } from '../../generated/prisma/client';

type PlanWithFeatures = Plan & { features: PlanFeature[] };

/**
 * Prices leave as **numbers**, not Prisma `Decimal` objects.
 *
 * A Decimal serialises to `{"s":1,"e":2,"d":[499]}` through the response
 * envelope, which the website would render as `[object Object]`. Every other
 * money field in this API has the same conversion at its edge.
 */
const rupees = (value: Plan['priceMonthly']) => Number(value);

/** What the website's card needs — PDF-free, design-shaped. */
export function toCard(plan: PlanWithFeatures) {
  return {
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    icon: plan.icon,
    eyebrow: plan.eyebrow,
    description: plan.description,
    priceMonthly: rupees(plan.priceMonthly),
    priceYearly: rupees(plan.priceYearly),
    billingCaption: plan.billingCaption,
    isPopular: plan.isPopular,
    features: plan.features.map((feature) => ({
      label: feature.label,
      included: feature.included,
    })),
  };
}

/**
 * The admin row. Carries `isActive`, the feature count and how many customers
 * chose it — the three things the card does not need and the table does.
 */
export function toAdminRow(plan: PlanWithFeatures, customerCount: number) {
  return {
    ...toCard(plan),
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    featureCount: plan.features.length,
    customerCount,
    createdAt: plan.createdAt,
  };
}
