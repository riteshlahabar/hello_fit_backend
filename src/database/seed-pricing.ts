/**
 * The pricing sheet the client supplied on 17 Nov 2026: six packages and the
 * three group-size slabs. Called from `seed.ts`; see `npm run db:seed`.
 *
 * A package holds a percent, never a rupee figure — the rate comes from
 * `Service.basePrice`, so these rows are the same for every trainer tier.
 */
import type { PrismaClient } from '../generated/prisma/client';

/**
 * Section 7 of the pricing guideline. `percentAdjust` is signed: positive is
 * the markup on short packages, negative the 90-day discount.
 *
 * `allowedWeekdays` is empty (any day) and `fixedInstructorAllowed` true on
 * every row — the client's sheet sets neither, so nothing is invented here.
 */
const PACKAGES: Array<{
  name: string;
  icon: string;
  sessionCount: number;
  validityDays: number;
  percentAdjust: number;
  freeSessionCount: number;
}> = [
  // 1 paid + 1 free, both delivered; the provider is paid for one.
  { name: 'Trial Offer', icon: '🎁', sessionCount: 1, validityDays: 7, percentAdjust: 20, freeSessionCount: 1 },
  { name: 'Weekly Fitness', icon: '⚡', sessionCount: 5, validityDays: 7, percentAdjust: 10, freeSessionCount: 0 },
  { name: 'Monthly Fitness', icon: '📅', sessionCount: 12, validityDays: 30, percentAdjust: 5, freeSessionCount: 0 },
  { name: 'Monthly Intensive', icon: '🔥', sessionCount: 24, validityDays: 30, percentAdjust: 0, freeSessionCount: 0 },
  { name: '90-Day Fitness Plan', icon: '🏅', sessionCount: 36, validityDays: 90, percentAdjust: -10, freeSessionCount: 0 },
  { name: '90-Day Intensive Plan', icon: '🏆', sessionCount: 72, validityDays: 90, percentAdjust: -15, freeSessionCount: 0 },
];

/**
 * `Package.name` carries no unique constraint — the admin may legitimately run
 * two packages of the same shape — so the match is a name lookup rather than an
 * upsert. An admin-edited row is left alone apart from its terms.
 */
async function seedPackages(prisma: PrismaClient) {
  let order = 0;

  for (const pack of PACKAGES) {
    const existing = await prisma.package.findFirst({
      where: { name: pack.name, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      await prisma.package.update({
        where: { id: existing.id },
        data: { ...pack, sortOrder: order },
      });
    } else {
      await prisma.package.create({
        data: { ...pack, sortOrder: order, allowedWeekdays: [] },
      });
    }

    order += 1;
  }

  console.log(`  packages: ${PACKAGES.length}`);
}

export async function seedPricing(prisma: PrismaClient) {
  await seedPackages(prisma);
}
