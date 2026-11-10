import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MastersRepository } from './masters.repository';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate } from '../../common/dates/calendar';
import type {
  BulkCreatePincodesDto,
  CreateAreaDto,
  CreateBranchDto,
  CreateCityDto,
  CreateHolidayDto,
  CreateLanguageDto,
  CreatePincodeDto,
  ListAreasQueryDto,
  ListBranchesQueryDto,
  ListHolidaysQueryDto,
  ListMastersQueryDto,
  ListPincodesQueryDto,
  UpdateAreaDto,
  UpdateBranchDto,
  UpdateCityDto,
  UpdateHolidayDto,
  UpdateLanguageDto,
  UpdatePincodeDto,
} from './dto/masters.dto';

export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Geography, language and holiday masters (spec 5.7).
 *
 * Three rules hold across every entity here:
 *
 * 1. **Soft delete, never hard** (except holidays, which nothing references).
 *    A booking from last March still points at the area it was served in; a
 *    row that vanishes takes that history with it.
 * 2. **Retiring a master is refused while live rows reference it.** Deactivating
 *    a city out from under its addresses is how a customer ends up unable to
 *    book at an address they can still see. The error names the counts so ops
 *    knows what to clear first.
 * 3. **A child cannot hang off an inactive parent.** An area in a retired city,
 *    or a pincode in a retired area, is invisible to the slot engine but looks
 *    fine in the admin table — which is worse than being refused outright.
 *
 * Every mutation writes an audit row with before/after.
 */
@Injectable()
export class MastersService {
  constructor(
    private readonly repo: MastersRepository,
    private readonly audit: AuditService,
  ) {}

  private pageOf(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return { page, limit, skip: (page - 1) * limit, take: limit };
  }

  private metaOf(page: number, limit: number, total: number) {
    return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  private notFound(what: string): never {
    throw new NotFoundException({
      code: ErrorCode.NOT_FOUND,
      message: `${what} not found`,
    });
  }

  private duplicate(message: string): never {
    throw new ConflictException({
      code: ErrorCode.DUPLICATE_RESOURCE,
      message,
    });
  }

  private inUse(message: string, counts: Record<string, number>): never {
    throw new ConflictException({
      code: ErrorCode.MASTER_IN_USE,
      message,
      details: counts,
    });
  }

  // =========================================================================
  // City
  // =========================================================================

  async listCities(query: ListMastersQueryDto) {
    const { page, limit, skip, take } = this.pageOf(query);
    const { rows, total } = await this.repo.listCities({
      skip,
      take,
      q: query.q,
      includeInactive: query.includeInactive,
    });
    return { rows, meta: this.metaOf(page, limit, total) };
  }

  async getCity(id: string) {
    const city = await this.repo.findCity(id);
    if (!city) this.notFound('City');
    return city;
  }

  async createCity(dto: CreateCityDto, actor: AdminActor) {
    const state = dto.state ?? null;
    if (await this.repo.findCityByName(dto.name, state)) {
      this.duplicate(`A city named ${dto.name} already exists in that state`);
    }

    const city = await this.repo.createCity({
      name: dto.name,
      state,
      isActive: dto.isActive ?? true,
      launchDate: dto.launchDate ? parseCalendarDate(dto.launchDate) : null,
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.city_created',
      entityType: 'City',
      entityId: city.id,
      after: city,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return city;
  }

  async updateCity(id: string, dto: UpdateCityDto, actor: AdminActor) {
    const before = await this.getCity(id);

    if (dto.name !== undefined || dto.state !== undefined) {
      const name = dto.name ?? before.name;
      const state = dto.state !== undefined ? dto.state : before.state;
      const clash = await this.repo.findCityByName(name, state);
      if (clash && clash.id !== id) {
        this.duplicate(`A city named ${name} already exists in that state`);
      }
    }

    // Deactivating is the same decision as retiring, so it gets the same check.
    if (dto.isActive === false && before.isActive) {
      await this.assertCityRetirable(id);
    }

    const city = await this.repo.updateCity(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.state !== undefined ? { state: dto.state } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.launchDate !== undefined
        ? { launchDate: parseCalendarDate(dto.launchDate) }
        : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.city_updated',
      entityType: 'City',
      entityId: id,
      before,
      after: city,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return city;
  }

  private async assertCityRetirable(id: string) {
    const counts = await this.repo.cityDependents(id);
    if (counts.areas || counts.branches || counts.addresses) {
      this.inUse(
        'This city still has service areas, branches or customer addresses. Retire those first.',
        counts,
      );
    }
  }

  async deleteCity(id: string, actor: AdminActor) {
    const before = await this.getCity(id);
    await this.assertCityRetirable(id);

    const city = await this.repo.updateCity(id, {
      isActive: false,
      deletedAt: new Date(),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.city_deleted',
      entityType: 'City',
      entityId: id,
      before,
      after: city,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }

  // =========================================================================
  // Service area
  // =========================================================================

  async listAreas(query: ListAreasQueryDto) {
    const { page, limit, skip, take } = this.pageOf(query);
    const { rows, total } = await this.repo.listAreas({
      skip,
      take,
      q: query.q,
      includeInactive: query.includeInactive,
      cityId: query.cityId,
      branchId: query.branchId,
    });
    return { rows, meta: this.metaOf(page, limit, total) };
  }

  async getArea(id: string) {
    const area = await this.repo.findArea(id);
    if (!area) this.notFound('Service area');
    return area;
  }

  async createArea(dto: CreateAreaDto, actor: AdminActor) {
    const city = await this.repo.findCity(dto.cityId);
    if (!city) this.notFound('City');
    if (!city.isActive) {
      throw new BadRequestException({
        code: ErrorCode.MASTER_PARENT_INACTIVE,
        message: 'That city is not active, so an area cannot be added to it',
      });
    }

    if (await this.repo.findAreaByName(dto.cityId, dto.name)) {
      this.duplicate(`${city.name} already has an area named ${dto.name}`);
    }

    if (dto.branchId) await this.assertBranchInCity(dto.branchId, dto.cityId);

    const area = await this.repo.createArea({
      name: dto.name,
      city: { connect: { id: dto.cityId } },
      ...(dto.branchId ? { branch: { connect: { id: dto.branchId } } } : {}),
      isActive: dto.isActive ?? true,
      launchDate: dto.launchDate ? parseCalendarDate(dto.launchDate) : null,
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.area_created',
      entityType: 'ServiceArea',
      entityId: area.id,
      after: area,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return area;
  }

  /** A branch serving an area has to be in the same city as that area. */
  private async assertBranchInCity(branchId: string, cityId: string) {
    const branch = await this.repo.findBranch(branchId);
    if (!branch) this.notFound('Branch');
    if (branch.cityId !== cityId) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'That branch belongs to a different city',
      });
    }
    if (!branch.isActive) {
      throw new BadRequestException({
        code: ErrorCode.MASTER_PARENT_INACTIVE,
        message: 'That branch is not active',
      });
    }
  }

  async updateArea(id: string, dto: UpdateAreaDto, actor: AdminActor) {
    const before = await this.getArea(id);

    if (dto.name !== undefined && dto.name !== before.name) {
      const clash = await this.repo.findAreaByName(before.cityId, dto.name);
      if (clash && clash.id !== id) {
        this.duplicate(`That city already has an area named ${dto.name}`);
      }
    }

    if (dto.branchId) await this.assertBranchInCity(dto.branchId, before.cityId);
    if (dto.isActive === false && before.isActive) {
      await this.assertAreaRetirable(id);
    }

    const area = await this.repo.updateArea(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.branchId !== undefined
        ? { branch: { connect: { id: dto.branchId } } }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.launchDate !== undefined
        ? { launchDate: parseCalendarDate(dto.launchDate) }
        : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.area_updated',
      entityType: 'ServiceArea',
      entityId: id,
      before,
      after: area,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return area;
  }

  private async assertAreaRetirable(id: string) {
    const counts = await this.repo.areaDependents(id);
    if (counts.addresses || counts.instructorAreas) {
      this.inUse(
        'Customer addresses or teacher coverage still point at this area.',
        counts,
      );
    }
  }

  async deleteArea(id: string, actor: AdminActor) {
    const before = await this.getArea(id);
    await this.assertAreaRetirable(id);

    const area = await this.repo.updateArea(id, {
      isActive: false,
      deletedAt: new Date(),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.area_deleted',
      entityType: 'ServiceArea',
      entityId: id,
      before,
      after: area,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }

  // =========================================================================
  // Pincode
  // =========================================================================

  async listPincodes(query: ListPincodesQueryDto) {
    const { page, limit, skip, take } = this.pageOf(query);
    const { rows, total } = await this.repo.listPincodes({
      skip,
      take,
      q: query.q,
      includeInactive: query.includeInactive,
      areaId: query.areaId,
      cityId: query.cityId,
    });
    return { rows, meta: this.metaOf(page, limit, total) };
  }

  private async requireActiveArea(areaId: string) {
    const area = await this.repo.findArea(areaId);
    if (!area) this.notFound('Service area');
    if (!area.isActive) {
      throw new BadRequestException({
        code: ErrorCode.MASTER_PARENT_INACTIVE,
        message: 'That service area is not active',
      });
    }
    return area;
  }

  async createPincode(dto: CreatePincodeDto, actor: AdminActor) {
    await this.requireActiveArea(dto.areaId);
    if (await this.repo.findPincodeByCode(dto.code, dto.areaId)) {
      this.duplicate(`${dto.code} is already mapped to that area`);
    }

    const pincode = await this.repo.createPincode({
      code: dto.code,
      area: { connect: { id: dto.areaId } },
      isActive: dto.isActive ?? true,
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.pincode_created',
      entityType: 'Pincode',
      entityId: pincode.id,
      after: pincode,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return pincode;
  }

  /**
   * Bulk attach for a city launch. Reports which codes were skipped rather
   * than failing the whole batch on one duplicate — ops pastes a list and
   * wants to know what landed, not to diff it by hand.
   */
  async bulkCreatePincodes(dto: BulkCreatePincodesDto, actor: AdminActor) {
    await this.requireActiveArea(dto.areaId);

    const unique = [...new Set(dto.codes)];
    const existing = await this.repo.existingPincodeCodes(dto.areaId, unique);
    const skipped = existing.map((row) => row.code);
    const toCreate = unique.filter((code) => !skipped.includes(code));

    if (toCreate.length) {
      await this.repo.createPincodes(dto.areaId, toCreate);
    }

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.pincodes_bulk_created',
      entityType: 'ServiceArea',
      entityId: dto.areaId,
      after: { created: toCreate, skipped },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return {
      areaId: dto.areaId,
      created: toCreate.length,
      skipped,
      duplicatesInRequest: dto.codes.length - unique.length,
    };
  }

  async updatePincode(id: string, dto: UpdatePincodeDto, actor: AdminActor) {
    const before = await this.repo.findPincode(id);
    if (!before) this.notFound('Pincode');

    const areaId = dto.areaId ?? before.areaId;
    if (dto.areaId) await this.requireActiveArea(dto.areaId);

    const code = dto.code ?? before.code;
    if (code !== before.code || areaId !== before.areaId) {
      const clash = await this.repo.findPincodeByCode(code, areaId);
      if (clash && clash.id !== id) {
        this.duplicate(`${code} is already mapped to that area`);
      }
    }

    const pincode = await this.repo.updatePincode(id, {
      ...(dto.code !== undefined ? { code: dto.code } : {}),
      ...(dto.areaId !== undefined
        ? { area: { connect: { id: dto.areaId } } }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.pincode_updated',
      entityType: 'Pincode',
      entityId: id,
      before,
      after: pincode,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return pincode;
  }

  async deletePincode(id: string, actor: AdminActor) {
    const before = await this.repo.findPincode(id);
    if (!before) this.notFound('Pincode');

    // No dependency check: nothing has a foreign key to Pincode. An address
    // stores its pincode as a plain string, so retiring the mapping only means
    // the area can no longer be inferred from it.
    const pincode = await this.repo.updatePincode(id, {
      isActive: false,
      deletedAt: new Date(),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.pincode_deleted',
      entityType: 'Pincode',
      entityId: id,
      before,
      after: pincode,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }

  // =========================================================================
  // Branch
  // =========================================================================

  async listBranches(query: ListBranchesQueryDto) {
    const { page, limit, skip, take } = this.pageOf(query);
    const { rows, total } = await this.repo.listBranches({
      skip,
      take,
      q: query.q,
      includeInactive: query.includeInactive,
      cityId: query.cityId,
    });
    return { rows, meta: this.metaOf(page, limit, total) };
  }

  async getBranch(id: string) {
    const branch = await this.repo.findBranch(id);
    if (!branch) this.notFound('Branch');
    return branch;
  }

  private async assertManagerUsable(managerId: string) {
    const admin = await this.repo.findActiveAdmin(managerId);
    if (!admin) this.notFound('Admin user');
    if (admin.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'That admin account is not active',
      });
    }
  }

  async createBranch(dto: CreateBranchDto, actor: AdminActor) {
    const city = await this.repo.findCity(dto.cityId);
    if (!city) this.notFound('City');
    if (!city.isActive) {
      throw new BadRequestException({
        code: ErrorCode.MASTER_PARENT_INACTIVE,
        message: 'That city is not active, so a branch cannot be added to it',
      });
    }

    if (await this.repo.findBranchByName(dto.cityId, dto.name)) {
      this.duplicate(`${city.name} already has a branch named ${dto.name}`);
    }

    if (dto.managerId) await this.assertManagerUsable(dto.managerId);

    const branch = await this.repo.createBranch({
      name: dto.name,
      city: { connect: { id: dto.cityId } },
      address: dto.address,
      ...(dto.managerId
        ? { manager: { connect: { id: dto.managerId } } }
        : {}),
      isActive: dto.isActive ?? true,
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.branch_created',
      entityType: 'Branch',
      entityId: branch.id,
      after: branch,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return branch;
  }

  async updateBranch(id: string, dto: UpdateBranchDto, actor: AdminActor) {
    const before = await this.getBranch(id);

    if (dto.name !== undefined && dto.name !== before.name) {
      const clash = await this.repo.findBranchByName(before.cityId, dto.name);
      if (clash && clash.id !== id) {
        this.duplicate(`That city already has a branch named ${dto.name}`);
      }
    }

    if (dto.managerId) await this.assertManagerUsable(dto.managerId);
    if (dto.isActive === false && before.isActive) {
      await this.assertBranchRetirable(id);
    }

    const branch = await this.repo.updateBranch(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.managerId !== undefined
        ? { manager: { connect: { id: dto.managerId } } }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.branch_updated',
      entityType: 'Branch',
      entityId: id,
      before,
      after: branch,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return branch;
  }

  private async assertBranchRetirable(id: string) {
    const counts = await this.repo.branchDependents(id);
    if (counts.areas || counts.instructors || counts.staff) {
      this.inUse(
        'Service areas, teachers or admin staff are still attached to this branch.',
        counts,
      );
    }
  }

  async deleteBranch(id: string, actor: AdminActor) {
    const before = await this.getBranch(id);
    await this.assertBranchRetirable(id);

    const branch = await this.repo.updateBranch(id, {
      isActive: false,
      deletedAt: new Date(),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.branch_deleted',
      entityType: 'Branch',
      entityId: id,
      before,
      after: branch,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }

  // =========================================================================
  // Language
  // =========================================================================

  async listLanguages(query: ListMastersQueryDto) {
    const { page, limit, skip, take } = this.pageOf(query);
    const { rows, total } = await this.repo.listLanguages({
      skip,
      take,
      q: query.q,
      includeInactive: query.includeInactive,
    });
    return { rows, meta: this.metaOf(page, limit, total) };
  }

  async createLanguage(dto: CreateLanguageDto, actor: AdminActor) {
    if (await this.repo.findLanguageByCode(dto.code)) {
      this.duplicate(`Language ${dto.code} already exists`);
    }

    const makeDefault = dto.isDefault ?? false;
    const language = await this.repo.upsertLanguageAsDefault(
      null,
      {
        code: dto.code,
        name: dto.name,
        isActive: dto.isActive ?? true,
        isDefault: makeDefault,
      },
      makeDefault,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.language_created',
      entityType: 'Language',
      entityId: language.id,
      after: language,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return language;
  }

  async updateLanguage(id: string, dto: UpdateLanguageDto, actor: AdminActor) {
    const before = await this.repo.findLanguage(id);
    if (!before) this.notFound('Language');

    // The default language is what an un-profiled user and every template
    // falls back to, so it cannot be turned off or un-defaulted while it is
    // the only one. Promote another language first.
    const losingDefault =
      (dto.isDefault === false || dto.isActive === false) && before.isDefault;
    if (losingDefault && (await this.repo.countDefaultLanguages(id)) === 0) {
      throw new BadRequestException({
        code: ErrorCode.MASTER_DEFAULT_REQUIRED,
        message:
          'This is the default language. Make another language the default first.',
      });
    }

    const makeDefault = dto.isDefault === true;
    const language = await this.repo.upsertLanguageAsDefault(
      id,
      {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      },
      makeDefault,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.language_updated',
      entityType: 'Language',
      entityId: id,
      before,
      after: language,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return language;
  }

  async deleteLanguage(id: string, actor: AdminActor) {
    const before = await this.repo.findLanguage(id);
    if (!before) this.notFound('Language');

    if (before.isDefault) {
      throw new BadRequestException({
        code: ErrorCode.MASTER_DEFAULT_REQUIRED,
        message:
          'This is the default language. Make another language the default first.',
      });
    }

    const language = await this.repo.updateLanguage(id, {
      isActive: false,
      deletedAt: new Date(),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.language_deleted',
      entityType: 'Language',
      entityId: id,
      before,
      after: language,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }

  // =========================================================================
  // Holiday
  // =========================================================================

  async listHolidays(query: ListHolidaysQueryDto) {
    const { page, limit, skip, take } = this.pageOf(query);
    const { rows, total } = await this.repo.listHolidays({
      skip,
      take,
      q: query.q,
      cityId: query.cityId,
      from: query.from ? parseCalendarDate(query.from) : undefined,
      to: query.to ? parseCalendarDate(query.to) : undefined,
    });
    return { rows, meta: this.metaOf(page, limit, total) };
  }

  async createHoliday(dto: CreateHolidayDto, actor: AdminActor) {
    const date = parseCalendarDate(dto.date);
    const cityId = dto.cityId ?? null;

    if (cityId) {
      const city = await this.repo.findCity(cityId);
      if (!city) this.notFound('City');
    }

    if (await this.repo.findHolidayOn(date, cityId)) {
      this.duplicate(
        cityId
          ? 'That city already has a holiday on that date'
          : 'A national holiday already exists on that date',
      );
    }

    const holiday = await this.repo.createHoliday({
      date,
      title: dto.title,
      blocksBooking: dto.blocksBooking ?? true,
      ...(cityId ? { city: { connect: { id: cityId } } } : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.holiday_created',
      entityType: 'Holiday',
      entityId: holiday.id,
      after: holiday,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return holiday;
  }

  async updateHoliday(id: string, dto: UpdateHolidayDto, actor: AdminActor) {
    const before = await this.repo.findHoliday(id);
    if (!before) this.notFound('Holiday');

    const date = dto.date ? parseCalendarDate(dto.date) : before.date;
    if (dto.date && date.getTime() !== before.date.getTime()) {
      const clash = await this.repo.findHolidayOn(date, before.cityId);
      if (clash && clash.id !== id) {
        this.duplicate('A holiday already exists on that date');
      }
    }

    const holiday = await this.repo.updateHoliday(id, {
      ...(dto.date !== undefined ? { date } : {}),
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.blocksBooking !== undefined
        ? { blocksBooking: dto.blocksBooking }
        : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.holiday_updated',
      entityType: 'Holiday',
      entityId: id,
      before,
      after: holiday,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return holiday;
  }

  /**
   * Holidays hard-delete. The table has no `deletedAt`, nothing references a
   * holiday by id, and the slot engine reads the set by date — a soft-deleted
   * row would have to be filtered everywhere it is read, for no gain.
   */
  async deleteHoliday(id: string, actor: AdminActor) {
    const before = await this.repo.findHoliday(id);
    if (!before) this.notFound('Holiday');

    await this.repo.deleteHoliday(id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'master.holiday_deleted',
      entityType: 'Holiday',
      entityId: id,
      before,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }
}
