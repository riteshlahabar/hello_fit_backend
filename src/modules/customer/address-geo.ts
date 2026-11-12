import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/prisma/client';
import type { ServiceabilityService } from '../serviceability/serviceability.service';
import type { UpdateAddressDto } from './dto/customer.dto';

/**
 * PIN -> service area rules for address writes.
 *
 * Kept out of `customer.service.ts` for the reason `report-range.ts` was split
 * off `reports.service.ts`: the service is already 582 lines, and these are
 * pure decisions over a resolved area list, so they read better — and are
 * easier to reason about — on their own.
 *
 * Why this exists at all: the `pincodes` table has always been exactly this
 * mapping, but nothing resolved it. `POST /addresses` took `areaId` from the
 * client, the website had no way to supply one, and the address was saved with
 * `areaId: null` — at which point `findSlots` returns `[]`
 * (`availability.service.ts:84`). That empty slot grid was the one thing
 * between the booking flow and working end to end, on the website and in both
 * Flutter apps alike.
 */

export interface ResolvedGeo {
  areaId: string | null;
  cityId: string | null;
}

/**
 * What an address write should store for `areaId` / `cityId`.
 *
 * A code is unique per area, not globally (`@@unique([code, areaId])`), so one
 * PIN can straddle two areas — and Masters' bulk-attach makes that easy to do
 * by accident. The four cases:
 *
 * - `areaId` sent and the PIN is served there → taken as given.
 * - `areaId` sent, PIN served *elsewhere* → `PINCODE_AREA_MISMATCH`.
 * - no `areaId`, exactly one area → resolved silently. The common path.
 * - no `areaId`, several areas → `AREA_AMBIGUOUS` carrying the candidates, so
 *   the form can ask rather than file the customer under a set of teachers
 *   they never chose.
 *
 * A PIN the table does not know resolves to `null` and **the address still
 * saves**: `findSlots` already answers an area-less address with the design's
 * "coming soon, notify me" state (spec 3.1), and someone may legitimately save
 * a home we do not serve yet. For the same reason an unknown PIN does not
 * invalidate a client-sent `areaId` — an incomplete mapping is missing data,
 * not a contradiction, and refusing would regress addresses that save today.
 */
export async function resolveAddressGeo(
  serviceability: ServiceabilityService,
  pincode: string,
  areaId?: string,
  cityId?: string,
): Promise<ResolvedGeo> {
  const { areas } = await serviceability.resolve(pincode);

  if (areaId) {
    if (areas.length > 0 && !areas.some((area) => area.id === areaId)) {
      throw new BadRequestException({
        code: ErrorCode.PINCODE_AREA_MISMATCH,
        message: `PIN ${pincode} is not in the selected service area`,
        // `details` is the envelope's own carrier for field-level problems and
        // the only extra key `AllExceptionsFilter.describe` passes through; an
        // ad-hoc `areas` key is silently dropped.
        details: areas,
      });
    }
    return { areaId, cityId: cityId ?? null };
  }

  if (areas.length > 1) {
    throw new BadRequestException({
      code: ErrorCode.AREA_AMBIGUOUS,
      message: `PIN ${pincode} covers more than one service area — pick one`,
      details: areas,
    });
  }

  if (areas.length === 1) {
    return { areaId: areas[0].id, cityId: cityId ?? areas[0].cityId };
  }

  return { areaId: null, cityId: cityId ?? null };
}

/**
 * The `city` / `area` half of an address update.
 *
 * Moving an address to a new PIN used to write the PIN and keep the old
 * `areaId`, which is worse than having none: the slot grid would quietly go on
 * offering the previous neighbourhood's teachers. A changed PIN is re-resolved,
 * and an unresolvable one disconnects the area rather than leaving it stale.
 */
export async function addressGeoUpdate(
  serviceability: ServiceabilityService,
  address: { pincode: string; cityId: string | null },
  dto: UpdateAddressDto,
): Promise<Prisma.AddressUpdateInput> {
  const pincodeChanged =
    dto.pincode !== undefined && dto.pincode !== address.pincode;

  if (!pincodeChanged) {
    return {
      ...(dto.cityId !== undefined && {
        city: { connect: { id: dto.cityId } },
      }),
      ...(dto.areaId !== undefined && {
        area: { connect: { id: dto.areaId } },
      }),
    };
  }

  const resolved = await resolveAddressGeo(
    serviceability,
    dto.pincode as string,
    dto.areaId,
    dto.cityId ?? address.cityId ?? undefined,
  );

  return {
    area: resolved.areaId
      ? { connect: { id: resolved.areaId } }
      : { disconnect: true },
    ...(resolved.cityId && { city: { connect: { id: resolved.cityId } } }),
  };
}
