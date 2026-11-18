import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/prisma/client';
import type { UpdatePackageDto } from './dto/admin-package.dto';

/** Decimal leaves as a number; the admin table formats it, not the client. */
export function packageView<T extends { percentAdjust: Prisma.Decimal }>(
  row: T,
) {
  return { ...row, percentAdjust: Number(row.percentAdjust) };
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
  };
}
