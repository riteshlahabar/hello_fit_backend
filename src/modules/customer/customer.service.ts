import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerRepository } from './customer.repository';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate } from '../../common/dates/calendar';
import { isValidReferralCode, normaliseReferralCode } from './referral';
import type {
  CreateAddressDto,
  UpdateAddressDto,
  UpdateCustomerProfileDto,
} from './dto/customer.dto';
import type {
  AdminUpdateCustomerDto,
  BlockCustomerDto,
  ChangeCustomerStatusDto,
  ListCustomersQueryDto,
} from './dto/admin-customer.dto';

/**
 * Context carried into the audit trail. The token subject on an admin route is
 * the `AdminUser.id` — the same shape `InstructorService` uses, and for the
 * same reason: `AdminUser` has no `userId` column to resolve.
 */
export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Customer profile and address rules.
 *
 * This module closes the gap that made booking impossible: `booking.create`
 * resolves the caller's CustomerProfile and refuses without one, and the slot
 * grid and assignment both need a real Address row. Until now both had to be
 * inserted by hand.
 */
@Injectable()
export class CustomerService {
  constructor(
    private readonly repo: CustomerRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------- profile

  /**
   * The profile row is created by `auth.verifyLoginOtp` on first login, with an
   * empty name — so it effectively always exists and this does not 404 in
   * practice. `isComplete` is what the app should gate on: a blank name means
   * the person signed up but never finished the form.
   */
  async getProfile(userId: string) {
    const profile = await this.repo.findProfileByUserId(userId);
    if (!profile) {
      // Only reachable if the profile was soft-deleted out from under the user.
      throw new NotFoundException({
        code: ErrorCode.PROFILE_REQUIRED,
        message: 'Complete your profile to continue',
      });
    }
    return { ...profile, isComplete: profile.name.trim().length > 0 };
  }

  /**
   * Completes or edits the profile. There is no create endpoint: signup already
   * made the row, so a POST would always be a conflict.
   */
  async updateProfile(userId: string, dto: UpdateCustomerProfileDto) {
    const profile = await this.getProfile(userId);

    // A referrer can be set once, while the profile is still being completed.
    // Letting it change later would let someone re-attribute a reward.
    let referredById: string | undefined;
    if (dto.referredByCode !== undefined) {
      if (profile.referredById) {
        throw new ConflictException({
          code: ErrorCode.DUPLICATE_RESOURCE,
          message: 'A referral is already recorded on this account',
        });
      }
      referredById = await this.resolveReferrer(dto.referredByCode);
    }

    return this.repo.updateProfile(profile.id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.dob !== undefined && { dob: parseCalendarDate(dto.dob) }),
      ...(dto.goal !== undefined && { goal: dto.goal }),
      ...(dto.healthNotes !== undefined && { healthNotes: dto.healthNotes }),
      ...(referredById && { referredBy: { connect: { id: referredById } } }),
    });
  }

  /** A referral code that doesn't resolve is a typo, not a server error. */
  private async resolveReferrer(code: string): Promise<string> {
    if (!isValidReferralCode(code)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'That referral code is not valid',
      });
    }
    const referrer = await this.repo.findProfileByReferralCode(
      normaliseReferralCode(code),
    );
    if (!referrer) {
      throw new BadRequestException({
        code: ErrorCode.NOT_FOUND,
        message: 'That referral code does not exist',
      });
    }
    return referrer.id;
  }

  // --------------------------------------------------------------- addresses

  async listAddresses(userId: string) {
    const profile = await this.getProfile(userId);
    return this.repo.listAddresses(profile.id);
  }

  async getAddress(userId: string, addressId: string) {
    const profile = await this.getProfile(userId);
    const address = await this.repo.findAddress(profile.id, addressId);
    if (!address) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Address not found',
      });
    }
    return address;
  }

  async createAddress(userId: string, dto: CreateAddressDto) {
    const profile = await this.getProfile(userId);

    const { maxAddresses } = this.settings.all().customer;
    const count = await this.repo.countAddresses(profile.id);
    if (count >= maxAddresses) {
      throw new BadRequestException({
        code: ErrorCode.ADDRESS_LIMIT_REACHED,
        message: `You can save up to ${maxAddresses} addresses. Delete one first.`,
      });
    }

    await this.assertCityAndArea(dto.cityId, dto.areaId);

    // The first address is always the default — otherwise a customer could own
    // addresses with no default and the booking screen would have nothing to
    // preselect.
    const makeDefault = count === 0 || dto.isDefault === true;

    return this.repo.createAddress(
      profile.id,
      {
        label: dto.label,
        line1: dto.line1,
        line2: dto.line2 ?? null,
        landmark: dto.landmark ?? null,
        cityId: dto.cityId ?? null,
        areaId: dto.areaId ?? null,
        pincode: dto.pincode,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        accessNotes: dto.accessNotes ?? null,
      },
      makeDefault,
    );
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    const address = await this.getAddress(userId, addressId);
    await this.assertCityAndArea(dto.cityId, dto.areaId);

    return this.repo.updateAddress(address.id, {
      ...(dto.label !== undefined && { label: dto.label }),
      ...(dto.line1 !== undefined && { line1: dto.line1 }),
      ...(dto.line2 !== undefined && { line2: dto.line2 }),
      ...(dto.landmark !== undefined && { landmark: dto.landmark }),
      ...(dto.pincode !== undefined && { pincode: dto.pincode }),
      ...(dto.lat !== undefined && { lat: dto.lat }),
      ...(dto.lng !== undefined && { lng: dto.lng }),
      ...(dto.accessNotes !== undefined && { accessNotes: dto.accessNotes }),
      ...(dto.cityId !== undefined && {
        city: { connect: { id: dto.cityId } },
      }),
      ...(dto.areaId !== undefined && {
        area: { connect: { id: dto.areaId } },
      }),
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    const profile = await this.getProfile(userId);
    const address = await this.repo.findAddress(profile.id, addressId);
    if (!address) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Address not found',
      });
    }
    return this.repo.setDefaultAddress(profile.id, address.id);
  }

  /**
   * Soft delete. Refused while a session is still scheduled there — the
   * BookingSession FK is `onDelete: Restrict` for the same reason, and a
   * teacher en route needs the address to still resolve.
   */
  async deleteAddress(userId: string, addressId: string) {
    const profile = await this.getProfile(userId);
    const address = await this.repo.findAddress(profile.id, addressId);
    if (!address) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Address not found',
      });
    }

    const upcoming = await this.repo.countUpcomingSessionsAtAddress(address.id);
    if (upcoming > 0) {
      throw new ConflictException({
        code: ErrorCode.ADDRESS_IN_USE,
        message:
          upcoming === 1
            ? 'A session is still scheduled at this address. Cancel or reschedule it first.'
            : `${upcoming} sessions are still scheduled at this address. Cancel or reschedule them first.`,
      });
    }

    await this.repo.softDeleteAddress(profile.id, address.id, address.isDefault);
  }

  // ============================================================== admin side

  async listForAdmin(query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { rows, total } = await this.repo.listProfiles({
      q: query.q,
      status: query.status,
      trustBand: query.trustBand,
      isBlocked: query.isBlocked,
      includeDeleted: query.includeDeleted,
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** The customer file: profile, account, addresses and the wallet balance. */
  async getForAdmin(customerId: string) {
    const profile = await this.requireProfileById(customerId);
    const wallet = await this.repo.walletBalance(profile.id);

    return {
      ...profile,
      addresses: await this.repo.listAddresses(profile.id),
      wallet: wallet ?? { balance: 0, updatedAt: null },
    };
  }

  /**
   * Ops correcting the profile on a support call. The health notes are the
   * reason this exists: a customer who cannot get the app to save them leaves
   * the teacher arriving without knowing about an injury.
   */
  async updateForAdmin(
    customerId: string,
    dto: AdminUpdateCustomerDto,
    actor: AdminActor,
  ) {
    const profile = await this.requireProfileById(customerId);

    const updated = await this.repo.updateProfile(profile.id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.gender !== undefined && { gender: dto.gender }),
      // A date of birth is a calendar day, not an instant — parsing it as one
      // shifts it by a day either side of UTC midnight.
      ...(dto.dob !== undefined && { dob: parseCalendarDate(dto.dob) }),
      ...(dto.goal !== undefined && { goal: dto.goal }),
      ...(dto.healthNotes !== undefined && { healthNotes: dto.healthNotes }),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'customer.updated',
      entityType: 'CustomerProfile',
      entityId: profile.id,
      before: {
        name: profile.name,
        gender: profile.gender,
        goal: profile.goal,
        healthNotes: profile.healthNotes,
      },
      after: {
        name: updated.name,
        gender: updated.gender,
        goal: updated.goal,
        healthNotes: updated.healthNotes,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  /**
   * Suspends or reinstates the login. `DELETED` is refused here: removing a
   * customer is a deletion-request workflow (spec 10.3) with its own retention
   * rules, not a dropdown on the ops table.
   */
  async changeStatusForAdmin(
    customerId: string,
    dto: ChangeCustomerStatusDto,
    actor: AdminActor,
  ) {
    const profile = await this.requireProfileById(customerId);

    if (dto.status === 'DELETED') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'Deleting a customer goes through the data-deletion request, not a status change',
      });
    }

    const user = await this.repo.updateUserStatus(
      profile.userId,
      dto.status,
      dto.reason,
    );

    // Suspended and still holding a valid refresh token is suspended in name
    // only — the app would keep rotating it.
    let revokedSessions = 0;
    if (dto.status !== 'ACTIVE') {
      const { count } = await this.repo.revokeRefreshTokens(profile.userId);
      revokedSessions = count;
    }

    const upcomingSessions = await this.repo.countUpcomingSessionsForCustomer(
      profile.id,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'customer.status_changed',
      entityType: 'User',
      entityId: profile.userId,
      before: { status: profile.user.status },
      after: { status: user.status },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { ...profile, user, revokedSessions, upcomingSessions };
  }

  /**
   * The blacklist (spec 4.6). Distinct from a suspension: the account still
   * works, but `booking.create` refuses a blocked customer — which is why the
   * response reports how many sessions are already on the calendar.
   */
  async setBlockedForAdmin(
    customerId: string,
    dto: BlockCustomerDto,
    actor: AdminActor,
  ) {
    const profile = await this.requireProfileById(customerId);

    if (dto.isBlocked && !dto.reason) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A reason is required when blocking a customer',
      });
    }

    const updated = await this.repo.updateProfile(profile.id, {
      isBlocked: dto.isBlocked,
      blockReason: dto.isBlocked ? (dto.reason ?? null) : null,
    });

    const upcomingSessions = await this.repo.countUpcomingSessionsForCustomer(
      profile.id,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: dto.isBlocked ? 'customer.blocked' : 'customer.unblocked',
      entityType: 'CustomerProfile',
      entityId: profile.id,
      before: { isBlocked: profile.isBlocked, blockReason: profile.blockReason },
      after: { isBlocked: updated.isBlocked, blockReason: updated.blockReason },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { ...updated, upcomingSessions };
  }

  private async requireProfileById(customerId: string) {
    const profile = await this.repo.findProfileById(customerId);
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Customer not found',
      });
    }
    return profile;
  }

  /** Both are optional FKs; when supplied they must exist and agree. */
  private async assertCityAndArea(cityId?: string, areaId?: string) {
    if (cityId) {
      const city = await this.repo.cityExists(cityId);
      if (!city) {
        throw new BadRequestException({
          code: ErrorCode.FOREIGN_KEY_VIOLATION,
          message: 'Unknown city',
        });
      }
    }

    if (areaId) {
      const area = await this.repo.areaExists(areaId);
      if (!area) {
        throw new BadRequestException({
          code: ErrorCode.FOREIGN_KEY_VIOLATION,
          message: 'Unknown service area',
        });
      }
      if (cityId && area.cityId !== cityId) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'That area is not in the selected city',
        });
      }
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    );
  }
}
