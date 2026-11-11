import { Controller, Get, Query } from '@nestjs/common';
import {
  AllowAudience,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { ReportsService } from './reports.service';
import { ReportRangeQueryDto } from './dto/reports.dto';

/**
 * Reports (PDF 6.12). Four read-only routes, all on `reports:view` and all
 * taking the same `from`/`to` calendar-day range.
 *
 * Four routes rather than one with a `report` parameter: each answers a
 * different shape, and a single endpoint would either return all four on
 * every request or need a discriminated response the panel has to narrow.
 *
 * **No export route.** 6.12 grants export "only where explicitly included in
 * the agreed report requirements" and none are agreed, so `reports:export`
 * stays seeded and unused — see `ReportsService`.
 */
@Controller('admin/reports')
@AllowAudience('admin')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('customers-providers')
  @RequirePermissions('reports:view')
  async customersAndProviders(@Query() query: ReportRangeQueryDto) {
    return { data: await this.reports.customersAndProviders(query) };
  }

  @Get('bookings')
  @RequirePermissions('reports:view')
  async bookings(@Query() query: ReportRangeQueryDto) {
    return { data: await this.reports.bookings(query) };
  }

  @Get('payments')
  @RequirePermissions('reports:view')
  async payments(@Query() query: ReportRangeQueryDto) {
    return { data: await this.reports.payments(query) };
  }

  @Get('booking-status')
  @RequirePermissions('reports:view')
  async bookingStatus(@Query() query: ReportRangeQueryDto) {
    return { data: await this.reports.bookingStatus(query) };
  }
}
