import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Publishing a provider the moment ops approves them (client, 27-11-2026:
 * "after admin approve show immediately trainer on page").
 *
 * Until now approval wrote `onboardingStage` and `kycStatus` and nothing else,
 * while `provider-visibility.ts` additionally demands **one approved active
 * offering** — and since 26-11-2026 a trainer's own picks on page 15 are saved
 * pending on purpose (`offering-assign.ts`, spec 6.3). The two halves never
 * met: an approved trainer had active offerings, every one of them
 * `approvedAt: null`, so `GET /providers` excluded them permanently. The only
 * surface that could finish the job was the admin Edit dialog's Save, which
 * shows a pending pick and an approved one identically — nothing ever told ops
 * a second click was owed.
 *
 * So approval now approves the offerings the trainer is waiting on. This is a
 * deliberate narrowing of spec 6.3: the Teacher Manager's separate approval
 * still governs services a trainer adds **later**, which arrive pending and
 * stay pending; it no longer governs the set they registered with, because
 * approving the person and approving what they registered to teach is one
 * decision taken by one person in one screen.
 *
 * Guarded on `kycStatus`, the same condition `setOfferingApproval` enforces
 * per service — an unverified provider is never published, approval or not.
 * Retired services are filtered out rather than refused: one withdrawn service
 * must not block a trainer's approval, and publishing an unbookable offering
 * is exactly what that filter prevents.
 */
export async function publishPendingOfferings(
  prisma: PrismaService,
  profile: { id: string; onboardingStage: string; kycStatus: string },
) {
  const { id: instructorId, onboardingStage, kycStatus } = profile;
  if (onboardingStage !== 'APPROVED' || kycStatus !== 'VERIFIED') return [];

  const pending = await prisma.instructorService.findMany({
    where: {
      instructorId,
      deletedAt: null,
      isActive: true,
      approvedAt: null,
      service: { isActive: true, deletedAt: null },
    },
    select: { id: true, service: { select: { name: true } } },
  });

  if (pending.length === 0) return [];

  await prisma.instructorService.updateMany({
    where: { id: { in: pending.map((row) => row.id) } },
    data: { approvedAt: new Date() },
  });

  return pending.map((row) => row.service.name);
}
