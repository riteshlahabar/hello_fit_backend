import type { PrismaClient } from '../generated/prisma/client';

/**
 * The three membership plans, exactly as the client's design draws them
 * (`website design frontview/hellofit-membership-plans-subscription.html`).
 *
 * Seeded rather than left empty because the Plans page with no plans is a
 * blank screen, and a reviewer cannot tell "not seeded" from "broken".
 *
 * **Prices are the demo's, and the demo says so itself**: "Illustrative plan
 * pricing for this prototype. Final prices, benefits, taxes and renewal terms
 * should be confirmed before launch." An administrator edits them in the
 * panel; nothing here is a commitment.
 *
 * In its own file because `seed.ts` is already 418 lines (200-line rule).
 */
const PLANS = [
  {
    name: 'Starter',
    icon: '🌱',
    eyebrow: 'Start strong',
    description: 'For building a consistent fitness habit, one session at a time.',
    priceMonthly: 0,
    priceYearly: 0,
    billingCaption: 'No membership fee',
    isPopular: false,
    sortOrder: 0,
    features: [
      ['Book individual trainer sessions', true],
      ['Access trainer profiles & reviews', true],
      ['Manage bookings in your dashboard', true],
      ['Standard customer support', true],
      ['Member-only offers', false],
      ['Priority support', false],
    ] as const,
  },
  {
    name: 'Plus',
    icon: '🔥',
    eyebrow: 'Build momentum',
    description: 'For members who want extra perks to keep their routine on track.',
    priceMonthly: 499,
    priceYearly: 399,
    billingCaption: 'Billed monthly · Cancel anytime',
    isPopular: true,
    sortOrder: 1,
    features: [
      ['Member-only booking offers', true],
      ['Early access to selected slots', true],
      ['Monthly progress check-in', true],
      ['Priority customer support', true],
      ['Exclusive fitness tips', true],
      ['Dedicated fitness concierge', false],
    ] as const,
  },
  {
    name: 'Premium',
    icon: '👑',
    eyebrow: 'Go all in',
    description: 'For a more supported experience with elevated member benefits.',
    priceMonthly: 999,
    priceYearly: 799,
    billingCaption: 'Billed monthly · Cancel anytime',
    isPopular: false,
    sortOrder: 2,
    features: [
      ['Dedicated fitness concierge', true],
      ['Personalised monthly goal review', true],
      ['Premium member-only offers', true],
      ['Priority help with booking changes', true],
      ['Enhanced progress insights', true],
      ['Early access to new features', true],
    ] as const,
  },
];

/**
 * Idempotent, like the rest of the seed: an existing plan is left exactly as
 * it is. Re-running must never overwrite a price an administrator has edited.
 */
export async function seedPlans(prisma: PrismaClient) {
  for (const { features, ...plan } of PLANS) {
    const slug = plan.name.toLowerCase();
    const existing = await prisma.plan.findFirst({ where: { slug } });

    if (existing) continue;

    await prisma.plan.create({
      data: {
        ...plan,
        slug,
        features: {
          create: features.map(([label, included], sortOrder) => ({
            label,
            included,
            sortOrder,
          })),
        },
      },
    });
  }

  console.log(`  plans: ${PLANS.length} checked`);
}
