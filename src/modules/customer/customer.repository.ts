import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { TrustBand, UserStatus } from '../../generated/prisma/enums';
import type { SessionStatus } from '../../generated/prisma/enums';

/**
 * A session that has not yet run its course — booked, under way, or waiting on
 * a decision. Defined once: the address check and the customer check must not
 * drift apart on what "upcoming" means.
 */
const LIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'REASSIGNMENT_NEEDED',
  'RESCHEDULE_REQUESTED',
];

/**
 * Prisma queries for customer profiles and addresses. No business rules here —
 * those live in the service. Every address query is scoped by `customerId`, so
 * ownership is enforced at the query and not left to the controller.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------- profile

  /**
   * The profile plus the account identifiers that live on `User` — the
   * website's profile page shows the mobile and email alongside the name, and
   * they are on the other table.
   */
  findProfileByUserId(userId: string) {
    return this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      include: { user: { select: { mobile: true, email: true } } },
    });
  }

  /** The email lives on `User`, so changing it is a second write. */
  updateUserEmail(userId: string, email: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { email },
      select: { mobile: true, email: true },
    });
  }

  /** Is this email already on another account? `User.email` is unique. */
  async emailTaken(userId: string, email: string) {
    const count = await this.prisma.user.count({
      where: { email, id: { not: userId }, deletedAt: null },
    });
    return count > 0;
  }

  findProfileByReferralCode(referralCode: string) {
    return this.prisma.customerProfile.findFirst({
      where: { referralCode, deletedAt: null },
      select: { id: true },
    });
  }

  updateProfile(id: string, data: Prisma.CustomerProfileUpdateInput) {
    return this.prisma.customerProfile.update({ where: { id }, data });
  }

  // ------------------------------------------------------------- admin reads

  /**
   * The admin table's page. `deletedAt` is only relaxed when the switch asks
   * for it, so the default view is the live set.
   *
   * `q` searches the profile's name and the account's mobile and email, which
   * is what a support agent has in front of them when a customer calls.
   */
  async listProfiles(filter: {
    q?: string;
    status?: UserStatus;
    trustBand?: TrustBand;
    isBlocked?: boolean;
    includeDeleted?: boolean;
    skip: number;
    take: number;
  }) {
    const where: Prisma.CustomerProfileWhereInput = {
      ...(filter.includeDeleted ? {} : { deletedAt: null }),
      ...(filter.trustBand && { trustBand: filter.trustBand }),
      ...(filter.isBlocked !== undefined && { isBlocked: filter.isBlocked }),
      ...(filter.status && { user: { status: filter.status } }),
      ...(filter.q && {
        OR: [
          { name: { contains: filter.q, mode: 'insensitive' } },
          { user: { mobile: { contains: filter.q } } },
          { user: { email: { contains: filter.q, mode: 'insensitive' } } },
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customerProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: {
          user: {
            select: {
              id: true,
              mobile: true,
              email: true,
              status: true,
              lastLoginAt: true,
            },
          },
          _count: { select: { bookings: true, addresses: true } },
        },
      }),
      this.prisma.customerProfile.count({ where }),
    ]);

    return { rows, total };
  }

  /** Soft-deleted rows included: the table can page to them. */
  findProfileById(id: string) {
    return this.prisma.customerProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            mobile: true,
            email: true,
            status: true,
            language: true,
            lastLoginAt: true,
            suspendedAt: true,
            suspendReason: true,
          },
        },
        referredBy: { select: { id: true, name: true } },
        _count: { select: { bookings: true, referrals: true } },
      },
    });
  }

  walletBalance(customerId: string) {
    return this.prisma.walletAccount.findUnique({
      where: { customerId },
      select: { balance: true, updatedAt: true },
    });
  }

  // ----------------------------------------------------------- admin writes

  /**
   * Account status lives on `User`, not on the profile — suspending a customer
   * is suspending their login, and the same row backs an instructor account
   * when one person is both.
   */
  updateUserStatus(
    userId: string,
    status: UserStatus,
    reason: string,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        status,
        suspendedAt: status === 'ACTIVE' ? null : new Date(),
        suspendReason: status === 'ACTIVE' ? null : reason,
      },
      select: { id: true, status: true, suspendedAt: true, suspendReason: true },
    });
  }

  /**
   * Ends the app session rather than leaving it to run until the access token
   * expires. Only refresh tokens are revocable — the access token is stateless
   * and lives out its few minutes either way.
   */
  revokeRefreshTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --------------------------------------------------------------- addresses

  listAddresses(customerId: string) {
    return this.prisma.address.findMany({
      where: { customerId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        city: { select: { id: true, name: true } },
        area: { select: { id: true, name: true } },
      },
    });
  }

  findAddress(customerId: string, addressId: string) {
    return this.prisma.address.findFirst({
      where: { id: addressId, customerId, deletedAt: null },
      include: {
        city: { select: { id: true, name: true } },
        area: { select: { id: true, name: true } },
      },
    });
  }

  countAddresses(customerId: string) {
    return this.prisma.address.count({
      where: { customerId, deletedAt: null },
    });
  }

  /**
   * Creates the address and, when it should become the default, clears the flag
   * from the others in the same transaction — "exactly one default" must never
   * be observable as zero or two.
   */
  createAddress(
    customerId: string,
    data: Omit<Prisma.AddressUncheckedCreateInput, 'customerId'>,
    makeDefault: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({
          where: { customerId, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: { ...data, customerId, isDefault: makeDefault },
        include: {
          city: { select: { id: true, name: true } },
          area: { select: { id: true, name: true } },
        },
      });
    });
  }

  updateAddress(id: string, data: Prisma.AddressUpdateInput) {
    return this.prisma.address.update({
      where: { id },
      data,
      include: {
        city: { select: { id: true, name: true } },
        area: { select: { id: true, name: true } },
      },
    });
  }

  setDefaultAddress(customerId: string, addressId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { customerId, deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
      return tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });
  }

  /**
   * Soft-deletes, and promotes the oldest surviving address when the deleted
   * one was the default — a customer with addresses always has a default.
   */
  softDeleteAddress(customerId: string, addressId: string, wasDefault: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id: addressId },
        data: { deletedAt: new Date(), isDefault: false },
      });

      if (!wasDefault) return;

      const next = await tx.address.findFirst({
        where: { customerId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await tx.address.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    });
  }

  /**
   * Sessions still on this customer's calendar. Reported alongside a block or
   * a suspension: the flag stops the *next* booking, it does not clear the
   * ones already scheduled, and somebody has to decide about those.
   */
  countUpcomingSessionsForCustomer(customerId: string) {
    return this.prisma.bookingSession.count({
      where: {
        booking: { customerId },
        deletedAt: null,
        status: { in: [...LIVE_SESSION_STATUSES] },
      },
    });
  }

  /**
   * Sessions still ahead of us at this address. Deleting an address out from
   * under a scheduled session would leave the teacher with nowhere to go.
   */
  countUpcomingSessionsAtAddress(addressId: string) {
    return this.prisma.bookingSession.count({
      where: {
        addressId,
        deletedAt: null,
        status: { in: [...LIVE_SESSION_STATUSES] },
      },
    });
  }

  // ------------------------------------------------------------------ lookup

  cityExists(cityId: string) {
    return this.prisma.city.findFirst({
      where: { id: cityId, deletedAt: null },
      select: { id: true },
    });
  }

  areaExists(areaId: string) {
    return this.prisma.serviceArea.findFirst({
      where: { id: areaId, deletedAt: null },
      select: { id: true, cityId: true },
    });
  }
}
