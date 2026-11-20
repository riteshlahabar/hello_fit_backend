import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The set of services one provider delivers, written in one go from the admin
 * Edit dialog (client, 20-11-2026: "give option to select service, show
 * service according to category which is already selected at registration").
 *
 * **The list is the whole set, not a delta.** A multi-select says "these and
 * only these", so an id left out is withdrawn. That is also why this is one
 * function and one transaction rather than an add route and a remove route:
 * half an applied selection is a provider advertising a service the admin
 * just took away.
 *
 * **Choosing is approving.** `InstructorService.approvedAt` is the switch
 * `provider-visibility.ts` reads, and the row-menu publish action that used to
 * write it is gone (client, same day: "remove services from action popup"), so
 * an admin's pick sets it. Nothing is published by accident: `PUBLIC_PROVIDER`
 * still demands `status: ACTIVE` and `kycStatus: VERIFIED` on top.
 *
 * **No category check here.** The dialog narrows the options to the categories
 * the provider chose at registration; the stored `specialisations` are free
 * text that happens to hold category names, so enforcing a match on the way in
 * would reject a legitimate pick whenever a category is renamed. Existence and
 * being active are checked, and those are the two that would publish something
 * unbookable.
 */
export async function setInstructorServices(
  prisma: PrismaService,
  instructorId: string,
  serviceIds: string[],
) {
  const wanted = [...new Set(serviceIds)];

  if (wanted.length > 0) {
    const live = await prisma.service.findMany({
      where: { id: { in: wanted }, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (live.length !== wanted.length) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'One of those services no longer exists or has been retired',
      });
    }
  }

  // Soft deletes are read too. `@@unique([instructorId, serviceId])` is not
  // scoped by `deletedAt`, so creating a row over a soft-deleted one is a
  // constraint violation — a withdrawn service is revived, never re-created.
  const existing = await prisma.instructorService.findMany({
    where: { instructorId },
    select: { id: true, serviceId: true, isActive: true, approvedAt: true },
  });

  const published = (row: { isActive: boolean; approvedAt: Date | null }) =>
    row.isActive && row.approvedAt !== null;

  const before = existing
    .filter(published)
    .map((row) => row.serviceId)
    .sort();

  const known = new Map(existing.map((row) => [row.serviceId, row]));
  const now = new Date();

  await prisma.$transaction([
    ...existing
      .filter((row) => !wanted.includes(row.serviceId) && published(row))
      .map((row) =>
        prisma.instructorService.update({
          where: { id: row.id },
          // Not a soft delete: the row carries the history of having offered
          // this service, and reviving it is one update when ops changes
          // their mind.
          data: { isActive: false, approvedAt: null },
        }),
      ),

    ...wanted.map((serviceId) => {
      const row = known.get(serviceId);

      return row
        ? prisma.instructorService.update({
            where: { id: row.id },
            data: {
              isActive: true,
              deletedAt: null,
              // Keep the original approval instant where there is one, so the
              // audit trail does not restate a decision nobody retook.
              approvedAt: row.approvedAt ?? now,
            },
          })
        : prisma.instructorService.create({
            data: { instructorId, serviceId, isActive: true, approvedAt: now },
          });
    }),
  ]);

  return { before, after: [...wanted].sort() };
}
