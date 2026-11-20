import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { TrainerBookingsService } from './bookings.service';
import { TrainerClientsService } from './clients.service';
import { TrainerDashboardService } from './dashboard.service';
import { TrainerEarningsService } from './earnings.service';
import { InstructorContextService } from './instructor-context.service';
import { TrainerRequestsService } from './requests.service';
import {
  AcceptRequestDto,
  RejectRequestDto,
  TrainerBookingsQueryDto,
  TrainerClientsQueryDto,
  TrainerEarningsQueryDto,
} from './dto/trainer-app.dto';

/**
 * The four trainer-app tabs behind the client's HTML pack: Home (24),
 * Bookings (30–34, 37), Clients (38, 39) and Earnings (57).
 *
 * Every date on this surface is `dd-mm-yyyy` (hard rule 4). It is safe to
 * flip here because the trainer app is these routes' only consumer and both
 * sides ship together — `state/date-format.md` sets that bar.
 */
@Controller('app/instructor')
@AllowAudience('app')
@Roles('INSTRUCTOR')
export class TrainerAppController {
  constructor(
    private readonly context: InstructorContextService,
    private readonly dashboard: TrainerDashboardService,
    private readonly bookings: TrainerBookingsService,
    private readonly requests: TrainerRequestsService,
    private readonly clients: TrainerClientsService,
    private readonly earnings: TrainerEarningsService,
  ) {}

  /** Page 24. The one route that answers before approval — see the service. */
  @Get('dashboard')
  async home(@CurrentUser('id') userId: string) {
    const context = await this.context.peek(userId);
    return { data: await this.dashboard.load(context) };
  }

  @Get('bookings')
  async bookingList(
    @CurrentUser('id') userId: string,
    @Query() query: TrainerBookingsQueryDto,
  ) {
    const id = await this.context.require(userId);
    return this.bookings.list(id, query);
  }

  @Get('bookings/:id')
  async bookingDetail(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ) {
    const id = await this.context.require(userId);
    return { data: await this.bookings.detail(id, sessionId) };
  }

  /** Page 31 — the §4.7 inbox. */
  @Get('requests')
  async requestList(@CurrentUser('id') userId: string) {
    const id = await this.context.require(userId);
    return this.requests.list(id);
  }

  /** Page 33. */
  @Post('requests/:id/accept')
  async acceptRequest(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) requestId: string,
    @Body() dto: AcceptRequestDto,
  ) {
    const id = await this.context.require(userId);
    return {
      data: await this.requests.accept(id, requestId, dto.note),
      message: 'Booking accepted',
    };
  }

  /** Page 34. */
  @Post('requests/:id/reject')
  async rejectRequest(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectRequestDto,
  ) {
    const id = await this.context.require(userId);
    return {
      data: await this.requests.reject(id, requestId, dto.reason, dto.message),
      message: 'Request declined',
    };
  }

  @Get('clients')
  async clientList(
    @CurrentUser('id') userId: string,
    @Query() query: TrainerClientsQueryDto,
  ) {
    const id = await this.context.require(userId);
    return this.clients.list(id, query);
  }

  @Get('clients/:id')
  async clientDetail(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) customerId: string,
  ) {
    const id = await this.context.require(userId);
    return { data: await this.clients.detail(id, customerId) };
  }

  /** Page 57. The session-wise rows stay on the older `GET /earnings`. */
  @Get('earnings/summary')
  async earningsSummary(
    @CurrentUser('id') userId: string,
    @Query() query: TrainerEarningsQueryDto,
  ) {
    const id = await this.context.require(userId);
    return { data: await this.earnings.summary(id, query.period) };
  }
}
