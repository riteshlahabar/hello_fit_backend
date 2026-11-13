import type { Prisma } from '../../generated/prisma/client';

/**
 * Who is allowed to appear on the public website — PDF §5.5, "display only
 * providers permitted to appear publicly", and its acceptance criterion
 * "inactive or unapproved providers are not presented as available for
 * booking".
 *
 * Kept in its own file and used by **both** the list and the detail route.
 * Two copies of a visibility rule is how an unapproved provider ends up
 * unreachable from the list but reachable by guessing their id, and that is a
 * disclosure bug, not a cosmetic one.
 *
 * Four conditions, each for its own reason:
 *
 * - `deletedAt: null` — soft deletes are gone, not hidden.
 * - `status: ACTIVE` — suspended and blacklisted providers disappear.
 * - `kycStatus: VERIFIED` — identity checked before a stranger is sent to a
 *   customer's home. This is the one that makes the rule a safety rule.
 * - at least one **approved and active** service offering. The schema has
 *   carried `InstructorService.approvedAt` from the first migration for
 *   exactly this and nothing ever wrote it; the admin approval route does.
 *   Without it, "approved" would mean nothing and every onboarded provider
 *   would be public the moment their KYC passed.
 */
export const PUBLIC_PROVIDER: Prisma.InstructorProfileWhereInput = {
  deletedAt: null,
  status: 'ACTIVE',
  kycStatus: 'VERIFIED',
  instructorServices: {
    some: {
      deletedAt: null,
      isActive: true,
      approvedAt: { not: null },
      service: { isActive: true, deletedAt: null },
    },
  },
};

/**
 * The same rule applied to the nested offerings, so a visible provider cannot
 * advertise a service that is inactive or still awaiting approval. §5.6:
 * "services and prices correspond to that provider", and the booking action is
 * "available only for eligible services".
 */
export const PUBLIC_OFFERING: Prisma.InstructorServiceWhereInput = {
  deletedAt: null,
  isActive: true,
  approvedAt: { not: null },
  service: { isActive: true, deletedAt: null },
};
