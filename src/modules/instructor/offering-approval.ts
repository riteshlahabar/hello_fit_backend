import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Approving a provider's service offering — PDF 6.5, "manage permitted service
 * visibility", and the gate behind §5.5's "display only providers permitted to
 * appear publicly".
 *
 * `InstructorService.approvedAt` has existed since the first migration and
 * **nothing in the codebase ever wrote it**, so the column described a policy
 * that was not enforced anywhere. `provider-visibility.ts` now requires it,
 * which means this is the switch that puts a provider on the website at all.
 *
 * Split into its own file rather than added to `instructor.service.ts`, which
 * is already long; it is one decision with one audit entry.
 */
export async function setOfferingApproval(
  prisma: PrismaService,
  instructorId: string,
  serviceId: string,
  approved: boolean,
) {
  const offering = await prisma.instructorService.findFirst({
    where: { instructorId, serviceId, deletedAt: null },
    select: {
      id: true,
      approvedAt: true,
      isActive: true,
      service: { select: { name: true, isActive: true, deletedAt: true } },
      instructor: { select: { kycStatus: true, status: true } },
    },
  });

  if (!offering) {
    throw new NotFoundException({
      code: ErrorCode.NOT_FOUND,
      message: 'This provider does not offer that service',
    });
  }

  if (approved) {
    // Approving an offering of a retired service would publish something
    // nobody can book — the service's own visibility is 6.5's other half.
    if (!offering.service.isActive || offering.service.deletedAt) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `"${offering.service.name}" is not an active service`,
      });
    }

    // KYC before a stranger is listed as available to visit a home. The
    // search filter enforces this too; refusing here as well means an
    // administrator is told why rather than approving into silence.
    if (offering.instructor.kycStatus !== 'VERIFIED') {
      throw new BadRequestException({
        code: ErrorCode.ONBOARDING_INCOMPLETE,
        message: 'KYC must be verified before a service can be published',
      });
    }
  }

  const updated = await prisma.instructorService.update({
    where: { id: offering.id },
    data: { approvedAt: approved ? new Date() : null },
    select: {
      id: true,
      approvedAt: true,
      isActive: true,
      customPrice: true,
      service: { select: { id: true, name: true, basePrice: true } },
    },
  });

  return { offering, updated };
}
