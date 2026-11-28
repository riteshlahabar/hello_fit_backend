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

/**
 * The counterpart, and the defect it closes (client, 28-11-2026: "rejected
 * trainer dont show anywhere").
 *
 * `publishPendingOfferings` wrote `approvedAt` on approval and nothing ever
 * cleared it, so a trainer ops later rejected kept every published offering —
 * and `PUBLIC_PROVIDER` asks only for one approved active offering, never for
 * the stage. The rejected trainer stayed on the homepage, in search, on their
 * own profile URL and in a customer's Saved list.
 *
 * Deliberately narrow. It fires only when the move is **out of `APPROVED`**
 * (ops stepping a live trainer back, which is how the stage machine reaches a
 * rejection from `APPROVED` — see `allowedTransitions`) or **into
 * `REJECTED`** from anywhere. It must not fire on an ordinary forward step,
 * because an admin-created trainer sits at `APPLIED` while ops approves their
 * services by hand in the Edit dialog: withdrawing there would silently undo
 * a decision this function was never asked about.
 */
export async function withdrawPublishedOfferings(
  prisma: PrismaService,
  profile: { id: string },
  previousStage: string,
  nextStage: string,
) {
  const leavingApproved = previousStage === 'APPROVED';
  const rejected = nextStage === 'REJECTED';
  if (nextStage === 'APPROVED' || !(leavingApproved || rejected)) return [];

  const live = await prisma.instructorService.findMany({
    where: { instructorId: profile.id, approvedAt: { not: null } },
    select: { id: true, service: { select: { name: true } } },
  });

  if (live.length === 0) return [];

  // `approvedAt: null` only — `isActive` is the trainer's own switch and the
  // approval is ops', so a reopened application (`REJECTED` -> `APPLIED` ->
  // `APPROVED`) republishes exactly the set they registered with.
  await prisma.instructorService.updateMany({
    where: { id: { in: live.map((row) => row.id) } },
    data: { approvedAt: null },
  });

  return live.map((row) => row.service.name);
}
