import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/prisma/client';
import type { UpdatePackageDto } from './dto/admin-package.dto';

/** The services a package is sold on, as the panel's multi-select wants them. */
export const PACKAGE_SERVICES = {
  select: { service: { select: { id: true, name: true } } },
} as const;

type WithLinks = { services?: { service: { id: string; name: string } }[] };

/**
 * Decimal leaves as a number; the admin table formats it, not the client.
 * The service links are flattened to plain rows so the panel reads
 * `services[].name` rather than `services[].service.name`.
 */
export function packageView<T extends { percentAdjust: Prisma.Decimal }>(
  row: T & WithLinks,
) {
  return {
    ...row,
    percentAdjust: Number(row.percentAdjust),
    ...(row.services && { services: row.services.map((l) => l.service) }),
  };
}

export async function requirePackage(prisma: PrismaService, id: string) {
  const row = await prisma.package.findFirst({ where: { id, deletedAt: null } });

  if (!row) {
    throw new NotFoundException({
      code: ErrorCode.NOT_FOUND,
      message: 'Package not found',
    });
  }

  return row;
}

/**
 * Every id must name a live service, or the admin has ticked something that
 * cannot be sold and would never show on the site.
 */
export async function assertServicesExist(
  prisma: PrismaService,
  serviceIds: string[],
) {
  if (serviceIds.length === 0) return;

  const found = await prisma.service.count({
    where: { id: { in: serviceIds }, deletedAt: null },
  });

  if (found !== serviceIds.length) {
    throw new NotFoundException({
      code: ErrorCode.NOT_FOUND,
      message: 'One or more of those services no longer exist',
    });
  }
}

/**
 * The name is what the customer sees on the dropdown, so two packages called
 * "Monthly" is a support call waiting to happen. Checked here rather than
 * with a unique index: a retired row should not hold the name forever, and
 * `deletedAt` is part of the test.
 */
export async function assertPackageNameFree(
  prisma: PrismaService,
  name: string,
  exceptId?: string,
) {
  const clash = await prisma.package.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      deletedAt: null,
      ...(exceptId && { NOT: { id: exceptId } }),
    },
    select: { id: true, name: true },
  });

  if (clash) {
    throw new ConflictException({
      code: ErrorCode.DUPLICATE_RESOURCE,
      message: `A package called "${clash.name}" already exists`,
    });
  }
}

/**
 * Only the fields actually sent. An absent field must leave the stored value
 * alone — a PATCH that quietly reset `percentAdjust` to 0 would change every
 * price on the catalogue.
 *
 * `serviceIds` is the one exception to "merge": it replaces the whole list,
 * because a multi-select has no way to say "remove just this one".
 */
export function packageUpdateData(
  dto: UpdatePackageDto,
): Prisma.PackageUpdateInput {
  return {
    ...(dto.name !== undefined && { name: dto.name }),
    // An empty string is the admin clearing the symbol, which is null in the
    // column — the card then draws its own mark.
    ...(dto.icon !== undefined && { icon: dto.icon === '' ? null : dto.icon }),
    ...(dto.sessionCount !== undefined && { sessionCount: dto.sessionCount }),
    ...(dto.persons !== undefined && { persons: dto.persons }),
    ...(dto.validityDays !== undefined && { validityDays: dto.validityDays }),
    ...(dto.percentAdjust !== undefined && {
      percentAdjust: dto.percentAdjust,
    }),
    ...(dto.freeSessionCount !== undefined && {
      freeSessionCount: dto.freeSessionCount,
    }),
    ...(dto.allowedWeekdays !== undefined && {
      allowedWeekdays: dto.allowedWeekdays,
    }),
    ...(dto.fixedInstructorAllowed !== undefined && {
      fixedInstructorAllowed: dto.fixedInstructorAllowed,
    }),
    ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
    ...(dto.serviceIds !== undefined && {
      services: {
        deleteMany: {},
        create: dto.serviceIds.map((serviceId) => ({ serviceId })),
      },
    }),
  };
}
