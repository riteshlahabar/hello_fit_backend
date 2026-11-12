import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Pincode -> service area resolution.
 *
 * The `pincodes` table has always been exactly this mapping, but nothing
 * public read it: `POST /addresses` took `areaId` from the client and there
 * was no endpoint listing areas, so a website- or app-created address was
 * saved with `areaId: null` and `findSlots` then returned `[]`
 * (`availability.service.ts:84`). That empty slot grid was the one thing
 * between the booking flow and working end to end.
 *
 * A code is unique per area, not globally (`@@unique([code, areaId])`), so a
 * PIN that straddles two areas resolves to several. Callers get the list; only
 * an unambiguous single match is auto-applied to an address.
 */
@Injectable()
export class ServiceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every active area a PIN code falls in. Empty means "not serviceable yet",
   * which is the app's "coming soon, notify me" state (spec 3.1).
   */
  async resolve(pincode: string) {
    const rows = await this.prisma.pincode.findMany({
      where: {
        code: pincode,
        isActive: true,
        deletedAt: null,
        area: {
          isActive: true,
          deletedAt: null,
          city: { isActive: true, deletedAt: null },
        },
      },
      select: {
        area: {
          select: {
            id: true,
            name: true,
            cityId: true,
            city: { select: { name: true, state: true } },
          },
        },
      },
      orderBy: { area: { name: 'asc' } },
    });

    const areas = rows.map((row) => ({
      id: row.area.id,
      name: row.area.name,
      cityId: row.area.cityId,
      cityName: row.area.city.name,
      state: row.area.city.state,
    }));

    return { pincode, serviceable: areas.length > 0, areas };
  }

  /**
   * The public area list. Used by the address form when a PIN resolves to more
   * than one area, and by the "where do you serve" picker.
   */
  async listAreas(cityId?: string) {
    const areas = await this.prisma.serviceArea.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(cityId && { cityId }),
        city: { isActive: true, deletedAt: null },
      },
      select: {
        id: true,
        name: true,
        cityId: true,
        city: { select: { name: true, state: true } },
      },
      orderBy: [{ city: { name: 'asc' } }, { name: 'asc' }],
    });

    return areas.map((area) => ({
      id: area.id,
      name: area.name,
      cityId: area.cityId,
      cityName: area.city.name,
      state: area.city.state,
    }));
  }

  /**
   * The public city list — the one the profile and checkout forms never had.
   *
   * `Address.cityId` and `CustomerProfile.cityId` are FKs, so without this the
   * website had no legal value to send and left both fields display-only
   * (`worklog/2026-11-11`, fifth session). Only launched cities appear: an
   * inactive city has no bookable area under it.
   */
  async listCities() {
    const cities = await this.prisma.city.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, state: true },
      orderBy: [{ name: 'asc' }],
    });

    return cities;
  }
}
