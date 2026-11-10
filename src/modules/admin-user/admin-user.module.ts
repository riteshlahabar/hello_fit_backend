import { Module } from '@nestjs/common';
import {
  AdminRoleController,
  AdminUserController,
} from './admin-user.controller';
import { AdminUserRepository } from './admin-user.repository';
import { AdminUserService } from './admin-user.service';
import { AuditModule } from '../audit/audit.module';

/**
 * Admin accounts, roles and permissions (spec 5.8). Admin-audience only.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminUserController, AdminRoleController],
  providers: [AdminUserService, AdminUserRepository],
  exports: [AdminUserService],
})
export class AdminUserModule {}
