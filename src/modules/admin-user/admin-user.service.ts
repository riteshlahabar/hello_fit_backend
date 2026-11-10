import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AdminUserRepository } from './admin-user.repository';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  ChangeAdminStatusDto,
  ChangeOwnPasswordDto,
  CreateAdminUserDto,
  CreateRoleDto,
  ListAdminUsersQueryDto,
  ResetAdminPasswordDto,
  SetRolePermissionsDto,
  UpdateAdminUserDto,
  UpdateRoleDto,
} from './dto/admin-user.dto';

export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

const BCRYPT_ROUNDS = 10;
const SUPER_ADMIN_SLUG = 'super-admin';

/**
 * Admin accounts, roles and permissions (spec 5.8).
 *
 * This closes the gap that made the panel unusable beyond the seeded account:
 * there was no way to create an `AdminUser`, so every admin shared one login
 * and the audit trail could not attribute anything to a person.
 *
 * Four rules the whole module is built around:
 *
 * 1. **Nobody can lock everybody out.** Deleting, suspending or demoting the
 *    last active super admin is refused.
 * 2. **No self-harm.** An admin cannot suspend, delete or change the role of
 *    their own account — that is for a colleague to do, and it stops a
 *    mis-click ending someone's session permanently.
 * 3. **Losing access revokes sessions.** Suspend or delete also revokes every
 *    refresh token, otherwise a 15-minute access token keeps working and a
 *    valid refresh token keeps renewing it.
 * 4. **Password hashes never leave the repository.** Every read goes through a
 *    select that omits `passwordHash` and `twoFactorSecret`.
 */
@Injectable()
export class AdminUserService {
  constructor(
    private readonly repo: AdminUserRepository,
    private readonly audit: AuditService,
  ) {}

  private notFound(what: string): never {
    throw new NotFoundException({
      code: ErrorCode.NOT_FOUND,
      message: `${what} not found`,
    });
  }

  private selfAction(message: string): never {
    throw new ForbiddenException({
      code: ErrorCode.ADMIN_SELF_ACTION,
      message,
    });
  }

  // =========================================================================
  // Admin users
  // =========================================================================

  async list(query: ListAdminUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { rows, total } = await this.repo.list({
      skip: (page - 1) * limit,
      take: limit,
      q: query.q,
      roleId: query.roleId,
      branchId: query.branchId,
      status: query.status,
      includeDeleted: query.includeDeleted,
    });

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async get(id: string) {
    const admin = await this.repo.find(id);
    if (!admin) this.notFound('Admin user');
    return admin;
  }

  private async requireRole(roleId: string) {
    const role = await this.repo.findRole(roleId);
    if (!role) this.notFound('Role');
    return role;
  }

  private async requireUsableBranch(branchId: string) {
    const branch = await this.repo.findBranch(branchId);
    if (!branch) this.notFound('Branch');
    if (!branch.isActive) {
      throw new BadRequestException({
        code: ErrorCode.MASTER_PARENT_INACTIVE,
        message: 'That branch is not active',
      });
    }
  }

  async create(dto: CreateAdminUserDto, actor: AdminActor) {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) {
      // Including soft-deleted rows: the email column is uniquely indexed
      // without a deletedAt predicate, so a "deleted" admin still holds it.
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: existing.deletedAt
          ? 'An archived admin account already uses that email'
          : 'An admin account already uses that email',
      });
    }

    await this.requireRole(dto.roleId);
    if (dto.branchId) await this.requireUsableBranch(dto.branchId);

    const admin = await this.repo.create({
      email: dto.email,
      name: dto.name,
      mobile: dto.mobile,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      status: dto.status ?? 'ACTIVE',
      role: { connect: { id: dto.roleId } },
      ...(dto.branchId ? { branch: { connect: { id: dto.branchId } } } : {}),
      createdBy: { connect: { id: actor.adminUserId } },
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'admin_user.created',
      entityType: 'AdminUser',
      entityId: admin.id,
      after: admin,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return admin;
  }

  async update(id: string, dto: UpdateAdminUserDto, actor: AdminActor) {
    const before = await this.get(id);

    if (dto.roleId && dto.roleId !== before.roleId) {
      if (id === actor.adminUserId) {
        this.selfAction('You cannot change your own role');
      }
      await this.requireRole(dto.roleId);
      await this.assertNotLastSuperAdmin(before, 'change the role of');
    }

    if (dto.branchId) await this.requireUsableBranch(dto.branchId);

    const admin = await this.repo.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
      ...(dto.roleId !== undefined
        ? { role: { connect: { id: dto.roleId } } }
        : {}),
      ...(dto.branchId !== undefined
        ? { branch: { connect: { id: dto.branchId } } }
        : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'admin_user.updated',
      entityType: 'AdminUser',
      entityId: id,
      before,
      after: admin,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return admin;
  }

  /**
   * Refuses the action when `admin` is the last active super admin. Checked
   * for delete, suspend and role change — all three remove the last person who
   * could undo it.
   */
  private async assertNotLastSuperAdmin(
    admin: { id: string; role: { slug: string } },
    verb: string,
  ) {
    if (admin.role.slug !== SUPER_ADMIN_SLUG) return;
    if ((await this.repo.countActiveSuperAdmins(admin.id)) === 0) {
      throw new ConflictException({
        code: ErrorCode.ADMIN_LAST_SUPER_ADMIN,
        message: `This is the only active super admin, so you cannot ${verb} it. Promote another admin first.`,
      });
    }
  }

  async changeStatus(
    id: string,
    dto: ChangeAdminStatusDto,
    actor: AdminActor,
  ) {
    const before = await this.get(id);

    if (id === actor.adminUserId) {
      this.selfAction('You cannot change your own account status');
    }
    if (dto.status !== 'ACTIVE') {
      await this.assertNotLastSuperAdmin(before, 'deactivate');
    }

    const admin = await this.repo.update(id, { status: dto.status });

    // Losing ACTIVE has to end the session too. The access token lives 15
    // minutes and the refresh token would keep minting new ones.
    if (dto.status !== 'ACTIVE') {
      await this.repo.revokeRefreshTokens(id);
    }

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'admin_user.status_changed',
      entityType: 'AdminUser',
      entityId: id,
      before: { status: before.status },
      after: { status: admin.status },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return admin;
  }

  async remove(id: string, actor: AdminActor) {
    const before = await this.get(id);

    if (id === actor.adminUserId) {
      this.selfAction('You cannot delete your own account');
    }
    await this.assertNotLastSuperAdmin(before, 'delete');

    const admin = await this.repo.update(id, {
      status: 'DELETED',
      deletedAt: new Date(),
    });
    await this.repo.revokeRefreshTokens(id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'admin_user.deleted',
      entityType: 'AdminUser',
      entityId: id,
      before,
      after: admin,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }

  /**
   * An admin resets a colleague's password. Every session of theirs is
   * revoked: a password reset usually means the old one is compromised, and
   * leaving live refresh tokens behind defeats the reset.
   *
   * The new password is never echoed back and never written to the audit row.
   */
  async resetPassword(
    id: string,
    dto: ResetAdminPasswordDto,
    actor: AdminActor,
  ) {
    const target = await this.get(id);

    await this.repo.update(id, {
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
    });
    await this.repo.revokeRefreshTokens(id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'admin_user.password_reset',
      entityType: 'AdminUser',
      entityId: id,
      after: { email: target.email, sessionsRevoked: true },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, passwordReset: true };
  }

  /** An admin changing their own password, which requires the current one. */
  async changeOwnPassword(dto: ChangeOwnPasswordDto, actor: AdminActor) {
    const me = await this.repo.findForPasswordCheck(actor.adminUserId);
    if (!me) this.notFound('Admin user');

    const matches = await bcrypt.compare(dto.currentPassword, me.passwordHash);
    if (!matches) {
      throw new BadRequestException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Current password is incorrect',
      });
    }

    await this.repo.update(actor.adminUserId, {
      passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
    });
    // Other sessions are revoked; the caller keeps their current access token
    // until it expires, which is what every password-change flow does.
    await this.repo.revokeRefreshTokens(actor.adminUserId);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'admin_user.password_changed',
      entityType: 'AdminUser',
      entityId: actor.adminUserId,
      after: { sessionsRevoked: true },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { changed: true };
  }

  // =========================================================================
  // Roles and permissions
  // =========================================================================

  listRoles() {
    return this.repo.listRoles();
  }

  async getRole(id: string) {
    const role = await this.repo.findRole(id);
    if (!role) this.notFound('Role');
    return role;
  }

  listPermissions() {
    return this.repo.listPermissions();
  }

  private async assertPermissionsExist(ids: string[]) {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const found = await this.repo.countPermissionsByIds(unique);
    if (found !== unique.length) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'One or more permission ids do not exist',
      });
    }
  }

  async createRole(dto: CreateRoleDto, actor: AdminActor) {
    if (await this.repo.findRoleByNameOrSlug(dto.name, dto.slug)) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: 'A role with that name or slug already exists',
      });
    }

    const permissionIds = dto.permissionIds ?? [];
    await this.assertPermissionsExist(permissionIds);

    const role = await this.repo.createRole({
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      // isSystem stays false: only the seed creates built-in roles.
    });

    if (permissionIds.length) {
      await this.repo.setRolePermissions(role.id, permissionIds);
    }

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'role.created',
      entityType: 'Role',
      entityId: role.id,
      after: { ...role, permissionIds },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return this.getRole(role.id);
  }

  async updateRole(id: string, dto: UpdateRoleDto, actor: AdminActor) {
    const before = await this.getRole(id);

    // A built-in role's identity is referenced by the seed and by permission
    // checks; renaming it makes the two disagree.
    if (before.isSystem && dto.name !== undefined && dto.name !== before.name) {
      throw new ConflictException({
        code: ErrorCode.ROLE_IS_SYSTEM,
        message: 'Built-in roles cannot be renamed',
      });
    }

    const role = await this.repo.updateRole(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'role.updated',
      entityType: 'Role',
      entityId: id,
      before: { name: before.name, description: before.description },
      after: { name: role.name, description: role.description },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return this.getRole(id);
  }

  /**
   * Replaces a role's permissions. Allowed on built-in roles — the spec's
   * role-to-module mapping is a starting point ops is expected to tune — but
   * not on super-admin, which is the recovery path if a permission edit goes
   * wrong.
   */
  async setRolePermissions(
    id: string,
    dto: SetRolePermissionsDto,
    actor: AdminActor,
  ) {
    const before = await this.getRole(id);

    if (before.slug === SUPER_ADMIN_SLUG) {
      throw new ConflictException({
        code: ErrorCode.ROLE_IS_SYSTEM,
        message:
          'Super Admin keeps every permission — it is the way back in if another role is mis-configured.',
      });
    }

    await this.assertPermissionsExist(dto.permissionIds);
    const role = await this.repo.setRolePermissions(id, dto.permissionIds);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'role.permissions_set',
      entityType: 'Role',
      entityId: id,
      before: {
        permissions: before.rolePermissions.map(
          (rp) => `${rp.permission.module}:${rp.permission.action}`,
        ),
      },
      after: {
        permissions: role.rolePermissions.map(
          (rp) => `${rp.permission.module}:${rp.permission.action}`,
        ),
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return this.getRole(id);
  }

  async deleteRole(id: string, actor: AdminActor) {
    const before = await this.getRole(id);

    if (before.isSystem) {
      throw new ConflictException({
        code: ErrorCode.ROLE_IS_SYSTEM,
        message: 'Built-in roles cannot be deleted',
      });
    }

    const assigned = await this.repo.countAdminsWithRole(id);
    if (assigned > 0) {
      throw new ConflictException({
        code: ErrorCode.ROLE_IN_USE,
        message: `${assigned} admin account(s) still use this role. Move them first.`,
        details: { adminUsers: assigned },
      });
    }

    await this.repo.updateRole(id, { deletedAt: new Date() });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'role.deleted',
      entityType: 'Role',
      entityId: id,
      before,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id, deleted: true };
  }
}
