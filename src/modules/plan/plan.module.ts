import { Module } from '@nestjs/common';
import { AdminPlanController } from './admin-plan.controller';
import { PlanController } from './plan.controller';
import { PlanRepository } from './plan.repository';
import { PlanService } from './plan.service';
import { AuditModule } from '../audit/audit.module';

/**
 * Membership plans — the website's Plans page and its admin screen.
 * Client instruction, 13 Nov 2026; not in the v3 PDF.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminPlanController, PlanController],
  providers: [PlanService, PlanRepository],
  exports: [PlanService],
})
export class PlanModule {}
