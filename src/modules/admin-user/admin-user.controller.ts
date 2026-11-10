import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { AdminUserService, type AdminActor } from './admin-user.service';
import {
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

/**
 * Admin accounts (spec 5.8).
 *
 * Guarded by the `admins` permission module, which the seed grants to Super
 * Admin only. Creating an admin is creating a way into every customer record,
 * so it is not something an Operations Manager does by default.
 *
 * `admins:approve` — not `admins:edit` — gates status changes and password
 * resets: locking a colleague out or taking over their account is a different
 * class of action from correcting their phone number.
 */
@Controller('admin/admin-users')
@AllowAudience('admin')
export class AdminUserController {
  constructor(private readonly admins: AdminUserService) {}

  private actorOf(adminUserId: string, req: Request): AdminActor {
    return {
      adminUserId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }

  @Get()
  @RequirePermissions('admins:view')
  async list(@Query() query: ListAdminUsersQueryDto) {
    const { rows, meta } = await this.admins.list(query);
    return { data: rows, meta };
  }

  /**
   * The caller's own record. Declared before `:id` so "me" is not parsed as a
   * uuid, and open to any admin — reading your own profile needs no grant.
   */
  @Get('me')
  async me(@CurrentUser('id') adminUserId: string) {
    return { data: await this.admins.get(adminUserId) };
  }

  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  async changeOwnPassword(
    @Body() dto: ChangeOwnPasswordDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.changeOwnPassword(
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Password changed. Other sessions have been signed out.',
    };
  }

  @Get(':id')
  @RequirePermissions('admins:view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.admins.get(id) };
  }

  @Post()
  @RequirePermissions('admins:create')
  async create(
    @Body() dto: CreateAdminUserDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.create(dto, this.actorOf(adminUserId, req)),
      message: 'Admin account created',
    };
  }

  @Patch(':id')
  @RequirePermissions('admins:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.update(id, dto, this.actorOf(adminUserId, req)),
      message: 'Admin account updated',
    };
  }

  @Post(':id/status')
  @RequirePermissions('admins:approve')
  @HttpCode(HttpStatus.OK)
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeAdminStatusDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.changeStatus(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Status updated',
    };
  }

  @Post(':id/password')
  @RequirePermissions('admins:approve')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetAdminPasswordDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.resetPassword(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Password reset. Their sessions have been signed out.',
    };
  }

  @Delete(':id')
  @RequirePermissions('admins:delete')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.remove(id, this.actorOf(adminUserId, req)),
      message: 'Admin account removed',
    };
  }
}

/**
 * Roles and the permission catalogue (spec 5.8).
 *
 * The permission list is readable by anyone who can view admins — the role
 * editor has to render it — but changing a role is `admins:approve`, because
 * a permission edit silently widens what a whole group of people can do.
 */
@Controller('admin/roles')
@AllowAudience('admin')
export class AdminRoleController {
  constructor(private readonly admins: AdminUserService) {}

  private actorOf(adminUserId: string, req: Request): AdminActor {
    return {
      adminUserId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }

  @Get()
  @RequirePermissions('admins:view')
  async list() {
    return { data: await this.admins.listRoles() };
  }

  /** The full (module, action) catalogue, for the role editor's checkboxes. */
  @Get('permissions')
  @RequirePermissions('admins:view')
  async permissions() {
    return { data: await this.admins.listPermissions() };
  }

  @Get(':id')
  @RequirePermissions('admins:view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.admins.getRole(id) };
  }

  @Post()
  @RequirePermissions('admins:create')
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.createRole(dto, this.actorOf(adminUserId, req)),
      message: 'Role created',
    };
  }

  @Patch(':id')
  @RequirePermissions('admins:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.updateRole(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Role updated',
    };
  }

  @Put(':id/permissions')
  @RequirePermissions('admins:approve')
  async setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.setRolePermissions(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Permissions updated',
    };
  }

  @Delete(':id')
  @RequirePermissions('admins:delete')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.admins.deleteRole(id, this.actorOf(adminUserId, req)),
      message: 'Role deleted',
    };
  }
}
