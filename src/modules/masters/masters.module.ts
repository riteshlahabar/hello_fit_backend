import { Module } from '@nestjs/common';
import { AdminMastersController } from './admin-masters.controller';
import { AdminTrainerCategoryController } from './admin-trainer-category.controller';
import { AdminTrainerCategoryService } from './admin-trainer-category.service';
import { MastersRepository } from './masters.repository';
import { MastersService } from './masters.service';
import { AuditModule } from '../audit/audit.module';

/**
 * Geography, language and holiday masters (spec 5.7). Admin-only — nothing
 * here is customer-facing; the app reads geography through `catalog` and
 * `availability`.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminMastersController, AdminTrainerCategoryController],
  providers: [MastersService, MastersRepository, AdminTrainerCategoryService],
  exports: [MastersService],
})
export class MastersModule {}
