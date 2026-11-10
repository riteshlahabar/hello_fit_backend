import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { UserStatus } from '../../generated/prisma/enums';

/**
 * Prisma access for admin users, roles and permissions.
 *
 * `passwordHash` and `twoFactorSecret` are never in a select used by a
 * response path — `SAFE_SELECT` is what every read goes through. The one
 * exception is `findForPasswordCheck`, which exists solely to compare a hash.
 */
const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  mobile: true,
  status: true,
  roleId: true,
  branchId: true,
  twoFactorEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  role: { select: { id: true, name: true, slug: true, isSystem: true } },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AdminUserSelect;

@Injectable()
export class AdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ admin users

  async list(filter: {
    skip: number;
    take: number;
    q?: string;
    roleId?: string;
    branchId?: string;
    status?: UserStatus;
    includeDeleted?: boolean;
  }) {
    const where: Prisma.AdminUserWhereInput = {
      ...(filter.includeDeleted ? {} : { deletedAt: null }),
      ...(filter.roleId ? { roleId: filter.roleId } : {}),
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' as const } },
              { email: { contains: filter.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.adminUser.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: filter.skip,
        take: filter.take,
        select: SAFE_SELECT,
      }),
      this.prisma.adminUser.count({ where }),
    ]);

    return { rows, total };
  }

  find(id: string, includeDeleted = false) {
    return this.prisma.adminUser.findFirst({
      where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
      select: SAFE_SELECT,
    });
  }

  findByEmail(email: string) {
    return this.prisma.adminUser.findFirst({
      where: { email },
      select: { id: true, email: true, deletedAt: true },
    });
  }

  /** The only read that returns the hash. Used by the change-own-password flow. */
  findForPasswordCheck(id: string) {
    return this.prisma.adminUser.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, passwordHash: true, status: true },
    });
  }

  create(data: Prisma.AdminUserCreateInput) {
    return this.prisma.adminUser.create({ data, select: SAFE_SELECT });
  }

  update(id: string, data: Prisma.AdminUserUpdateInput) {
    return this.prisma.adminUser.update({
      where: { id },
      data,
      select: SAFE_SELECT,
    });
  }

  /**
   * Active super admins, optionally excluding one. Guards the "do not lock
   * everyone out" rule on delete, suspend and role change.
   */
  countActiveSuperAdmins(excludeId?: string) {
    return this.prisma.adminUser.count({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        role: { slug: 'super-admin' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Revokes every refresh token for an admin being suspended or removed. */
  revokeRefreshTokens(adminUserId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { adminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ------------------------------------------------------------------ roles

  listRoles() {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: [{ name: 'asc' }],
      include: {
        _count: { select: { adminUsers: true, rolePermissions: true } },
      },
    });
  }

  findRole(id: string) {
    return this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { adminUsers: true } },
      },
    });
  }

  findRoleByNameOrSlug(name: string, slug: string) {
    return this.prisma.role.findFirst({
      where: { OR: [{ name }, { slug }], deletedAt: null },
    });
  }

  createRole(data: Prisma.RoleCreateInput) {
    return this.prisma.role.create({ data });
  }

  updateRole(id: string, data: Prisma.RoleUpdateInput) {
    return this.prisma.role.update({ where: { id }, data });
  }

  countAdminsWithRole(roleId: string) {
    return this.prisma.adminUser.count({
      where: { roleId, deletedAt: null },
    });
  }

  /**
   * Replaces a role's permissions in one transaction. Delete-then-insert
   * rather than a diff: the set is small, and a half-applied diff would leave
   * a role with permissions nobody chose.
   */
  async setRolePermissions(roleId: string, permissionIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
          skipDuplicates: true,
        });
      }
      return tx.role.findUniqueOrThrow({
        where: { id: roleId },
        include: { rolePermissions: { include: { permission: true } } },
      });
    });
  }

  // ------------------------------------------------------------ permissions

  listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }

  countPermissionsByIds(ids: string[]) {
    return this.prisma.permission.count({ where: { id: { in: ids } } });
  }

  findBranch(id: string) {
    return this.prisma.branch.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, isActive: true },
    });
  }
}
