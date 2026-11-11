import { Controller, Get, Query } from '@nestjs/common';
import {
  AllowAudience,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { DashboardService } from './dashboard.service';
import { DashboardSummaryQueryDto } from './dto/dashboard.dto';

/**
 * Dashboard and summary (PDF 6.2). One route, read-only.
 *
 * 6.2's seventh bullet — "access to management sections" — is the screen's
 * job: every tile links into the menu that owns those rows. Nothing is served
 * here that the owning screen does not already serve under its own
 * permission, so `dashboard:view` alone is enough to read it.
 */
@Controller('admin/dashboard')
@AllowAudience('admin')
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('dashboard:view')
  async summary(@Query() query: DashboardSummaryQueryDto) {
    return { data: await this.dashboard.summary(query) };
  }
}
