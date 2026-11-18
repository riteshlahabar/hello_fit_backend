import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AddonLine } from './pricing.calculator';

/**
 * Add-on lines for a quote. Prices always come from the database, never from
 * the request — a client that sends its own figure is sending a wish.
 */
export async function loadAddonLines(
  prisma: PrismaService,
  serviceId: string,
  addonIds: string[] | undefined,
): Promise<AddonLine[]> {
  if (!addonIds?.length) {
    return [];
  }

  const rows = await prisma.addon.findMany({
    where: { id: { in: addonIds }, isActive: true, deletedAt: null },
    select: { id: true, price: true, applicableServiceIds: true },
  });

  if (rows.length !== addonIds.length) {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'One or more add-ons are unavailable',
    });
  }

  return rows.map((row) => {
    // An empty list on the add-on means it applies to every service.
    if (
      row.applicableServiceIds.length > 0 &&
      !row.applicableServiceIds.includes(serviceId)
    ) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'An add-on does not apply to this service',
      });
    }

    return { addonId: row.id, quantity: 1, unitPrice: Number(row.price) };
  });
}
