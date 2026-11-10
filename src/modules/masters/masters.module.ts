import { Module } from '@nestjs/common';
import { AdminMastersController } from './admin-masters.controller';
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
  controllers: [AdminMastersController],
  providers: [MastersService, MastersRepository],
  exports: [MastersService],
})
export class MastersModule {}
