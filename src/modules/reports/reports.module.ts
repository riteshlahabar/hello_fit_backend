import { Module } from '@nestjs/common';
import { AdminReportsController } from './admin-reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

/**
 * Reports (PDF 6.12). Admin-only and read-only — no migration, no seed
 * change, nothing exported: these are aggregates over tables other modules
 * already own.
 */
@Module({
  controllers: [AdminReportsController],
  providers: [ReportsService, ReportsRepository],
})
export class ReportsModule {}
