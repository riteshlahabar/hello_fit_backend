import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export interface PageFilter {
  skip: number;
  take: number;
}

/**
 * Prisma access for the geography, language and holiday masters. Queries only
 * — every rule lives in MastersService.
 *
 * Soft delete is the house style on these tables (`deletedAt`), so every read
 * filters `deletedAt: null`. A hard delete would break historic bookings and
 * addresses that still point at a retired area.
 */
@Injectable()
export class MastersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // City
  // -------------------------------------------------------------------------

  async listCities(
    filter: PageFilter & { q?: string; includeInactive?: boolean },
  ) {
    const where: Prisma.CityWhereInput = {
      deletedAt: null,
      ...(filter.includeInactive ? {} : { isActive: true }),
      ...(filter.q
        ? { name: { contains: filter.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.city.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: filter.skip,
        take: filter.take,
        include: {
          _count: { select: { serviceAreas: true, branches: true } },
        },
      }),
      this.prisma.city.count({ where }),
    ]);

    return { rows, total };
  }

  findCity(id: string) {
    return this.prisma.city.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { serviceAreas: true, branches: true } } },
    });
  }

  findCityByName(name: string, state: string | null) {
    return this.prisma.city.findFirst({
      where: { name, state, deletedAt: null },
    });
  }

  createCity(data: Prisma.CityCreateInput) {
    return this.prisma.city.create({ data });
  }

  updateCity(id: string, data: Prisma.CityUpdateInput) {
    return this.prisma.city.update({ where: { id }, data });
  }

  /** Live children that block retiring a city. */
  async cityDependents(id: string) {
    const [areas, branches, addresses] = await this.prisma.$transaction([
      this.prisma.serviceArea.count({ where: { cityId: id, deletedAt: null } }),
      this.prisma.branch.count({ where: { cityId: id, deletedAt: null } }),
      this.prisma.address.count({ where: { cityId: id, deletedAt: null } }),
    ]);
    return { areas, branches, addresses };
  }

  // -------------------------------------------------------------------------
  // Service area
  // -------------------------------------------------------------------------

  async listAreas(
    filter: PageFilter & {
      q?: string;
      includeInactive?: boolean;
      cityId?: string;
      branchId?: string;
    },
  ) {
    const where: Prisma.ServiceAreaWhereInput = {
      deletedAt: null,
      ...(filter.includeInactive ? {} : { isActive: true }),
      ...(filter.cityId ? { cityId: filter.cityId } : {}),
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.q
        ? { name: { contains: filter.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceArea.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: filter.skip,
        take: filter.take,
        include: {
          city: { select: { id: true, name: true, state: true } },
          branch: { select: { id: true, name: true } },
          _count: { select: { pincodes: true } },
        },
      }),
      this.prisma.serviceArea.count({ where }),
    ]);

    return { rows, total };
  }

  findArea(id: string) {
    return this.prisma.serviceArea.findFirst({
      where: { id, deletedAt: null },
      include: {
        city: { select: { id: true, name: true, state: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { pincodes: true } },
      },
    });
  }

  findAreaByName(cityId: string, name: string) {
    return this.prisma.serviceArea.findFirst({
      where: { cityId, name, deletedAt: null },
    });
  }

  createArea(data: Prisma.ServiceAreaCreateInput) {
    return this.prisma.serviceArea.create({ data });
  }

  updateArea(id: string, data: Prisma.ServiceAreaUpdateInput) {
    return this.prisma.serviceArea.update({ where: { id }, data });
  }

  async areaDependents(id: string) {
    const [addresses, instructorAreas] = await this.prisma.$transaction([
      this.prisma.address.count({ where: { areaId: id, deletedAt: null } }),
      this.prisma.instructorServiceArea.count({ where: { areaId: id } }),
    ]);
    return { addresses, instructorAreas };
  }

  // -------------------------------------------------------------------------
  // Pincode
  // -------------------------------------------------------------------------

  async listPincodes(
    filter: PageFilter & {
      q?: string;
      includeInactive?: boolean;
      areaId?: string;
      cityId?: string;
    },
  ) {
    const where: Prisma.PincodeWhereInput = {
      deletedAt: null,
      ...(filter.includeInactive ? {} : { isActive: true }),
      ...(filter.areaId ? { areaId: filter.areaId } : {}),
      ...(filter.cityId ? { area: { cityId: filter.cityId } } : {}),
      ...(filter.q ? { code: { startsWith: filter.q } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.pincode.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip: filter.skip,
        take: filter.take,
        include: {
          area: {
            select: {
              id: true,
              name: true,
              city: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.pincode.count({ where }),
    ]);

    return { rows, total };
  }

  findPincode(id: string) {
    return this.prisma.pincode.findFirst({
      where: { id, deletedAt: null },
      include: { area: { select: { id: true, name: true, cityId: true } } },
    });
  }

  findPincodeByCode(code: string, areaId: string) {
    return this.prisma.pincode.findFirst({
      where: { code, areaId, deletedAt: null },
    });
  }

  /** Which of these codes already exist under the area, for the bulk path. */
  existingPincodeCodes(areaId: string, codes: string[]) {
    return this.prisma.pincode.findMany({
      where: { areaId, code: { in: codes }, deletedAt: null },
      select: { code: true },
    });
  }

  createPincode(data: Prisma.PincodeCreateInput) {
    return this.prisma.pincode.create({ data });
  }

  createPincodes(areaId: string, codes: string[]) {
    return this.prisma.pincode.createMany({
      data: codes.map((code) => ({ areaId, code })),
      skipDuplicates: true,
    });
  }

  updatePincode(id: string, data: Prisma.PincodeUpdateInput) {
    return this.prisma.pincode.update({ where: { id }, data });
  }

  // -------------------------------------------------------------------------
  // Branch
  // -------------------------------------------------------------------------

  async listBranches(
    filter: PageFilter & {
      q?: string;
      includeInactive?: boolean;
      cityId?: string;
    },
  ) {
    const where: Prisma.BranchWhereInput = {
      deletedAt: null,
      ...(filter.includeInactive ? {} : { isActive: true }),
      ...(filter.cityId ? { cityId: filter.cityId } : {}),
      ...(filter.q
        ? { name: { contains: filter.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: filter.skip,
        take: filter.take,
        include: {
          city: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true, email: true } },
          _count: { select: { serviceAreas: true, instructors: true } },
        },
      }),
      this.prisma.branch.count({ where }),
    ]);

    return { rows, total };
  }

  findBranch(id: string) {
    return this.prisma.branch.findFirst({
      where: { id, deletedAt: null },
      include: {
        city: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true, email: true } },
        _count: { select: { serviceAreas: true, instructors: true } },
      },
    });
  }

  findBranchByName(cityId: string, name: string) {
    return this.prisma.branch.findFirst({
      where: { cityId, name, deletedAt: null },
    });
  }

  createBranch(data: Prisma.BranchCreateInput) {
    return this.prisma.branch.create({ data });
  }

  updateBranch(id: string, data: Prisma.BranchUpdateInput) {
    return this.prisma.branch.update({ where: { id }, data });
  }

  async branchDependents(id: string) {
    const [areas, instructors, staff] = await this.prisma.$transaction([
      this.prisma.serviceArea.count({ where: { branchId: id, deletedAt: null } }),
      this.prisma.instructorProfile.count({ where: { branchId: id } }),
      this.prisma.adminUser.count({ where: { branchId: id, deletedAt: null } }),
    ]);
    return { areas, instructors, staff };
  }

  // -------------------------------------------------------------------------
  // Language
  // -------------------------------------------------------------------------

  async listLanguages(
    filter: PageFilter & { q?: string; includeInactive?: boolean },
  ) {
    const where: Prisma.LanguageWhereInput = {
      deletedAt: null,
      ...(filter.includeInactive ? {} : { isActive: true }),
      ...(filter.q
        ? { name: { contains: filter.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.language.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.language.count({ where }),
    ]);

    return { rows, total };
  }

  findLanguage(id: string) {
    return this.prisma.language.findFirst({ where: { id, deletedAt: null } });
  }

  findLanguageByCode(code: string) {
    return this.prisma.language.findFirst({ where: { code, deletedAt: null } });
  }

  countDefaultLanguages(excludeId?: string) {
    return this.prisma.language.count({
      where: {
        isDefault: true,
        isActive: true,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /**
   * Creates or updates a language, clearing every other default in the same
   * transaction when this one becomes the default. Two defaults would make
   * "which language does an un-profiled user get" ambiguous.
   */
  async upsertLanguageAsDefault(
    id: string | null,
    data: Prisma.LanguageCreateInput | Prisma.LanguageUpdateInput,
    makeDefault: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.language.updateMany({
          where: { isDefault: true, ...(id ? { id: { not: id } } : {}) },
          data: { isDefault: false },
        });
      }
      return id
        ? tx.language.update({
            where: { id },
            data: data as Prisma.LanguageUpdateInput,
          })
        : tx.language.create({
            data: data as Prisma.LanguageCreateInput,
          });
    });
  }

  updateLanguage(id: string, data: Prisma.LanguageUpdateInput) {
    return this.prisma.language.update({ where: { id }, data });
  }

  // -------------------------------------------------------------------------
  // Holiday
  // -------------------------------------------------------------------------

  async listHolidays(
    filter: PageFilter & {
      q?: string;
      cityId?: string;
      from?: Date;
      to?: Date;
    },
  ) {
    const where: Prisma.HolidayWhereInput = {
      ...(filter.cityId ? { cityId: filter.cityId } : {}),
      ...(filter.q
        ? { title: { contains: filter.q, mode: 'insensitive' as const } }
        : {}),
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.holiday.findMany({
        where,
        orderBy: [{ date: 'asc' }],
        skip: filter.skip,
        take: filter.take,
        include: { city: { select: { id: true, name: true } } },
      }),
      this.prisma.holiday.count({ where }),
    ]);

    return { rows, total };
  }

  findHoliday(id: string) {
    return this.prisma.holiday.findUnique({
      where: { id },
      include: { city: { select: { id: true, name: true } } },
    });
  }

  findHolidayOn(date: Date, cityId: string | null) {
    return this.prisma.holiday.findFirst({ where: { date, cityId } });
  }

  createHoliday(data: Prisma.HolidayCreateInput) {
    return this.prisma.holiday.create({ data });
  }

  updateHoliday(id: string, data: Prisma.HolidayUpdateInput) {
    return this.prisma.holiday.update({ where: { id }, data });
  }

  /** Holiday is the one master with no `deletedAt` — a removed one is gone. */
  deleteHoliday(id: string) {
    return this.prisma.holiday.delete({ where: { id } });
  }

  /** Does this admin exist and are they usable as a branch manager? */
  findActiveAdmin(id: string) {
    return this.prisma.adminUser.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
  }
}
