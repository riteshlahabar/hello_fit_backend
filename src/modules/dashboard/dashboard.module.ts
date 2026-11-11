import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [AdminDashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
