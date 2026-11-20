import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { TrainerBookingsService } from './bookings.service';
import { TrainerClientsService } from './clients.service';
import { TrainerDashboardService } from './dashboard.service';
import { TrainerEarningsService } from './earnings.service';
import { InstructorContextService } from './instructor-context.service';
import { TrainerRequestsService } from './requests.service';
import { TrainerAppController } from './trainer-app.controller';

/**
 * The trainer app's Home, Bookings, Clients and Earnings tabs.
 *
 * A module of its own rather than more routes on `SessionModule`'s
 * `InstructorController`: that controller is the session-day machine
 * (check-in, check-out, duty) and these are read models over four different
 * domains. `InstructorContextService` is exported because the session
 * controller resolves the same profile.
 */
@Module({
  imports: [AssignmentModule],
  controllers: [TrainerAppController],
  providers: [
    InstructorContextService,
    TrainerDashboardService,
    TrainerBookingsService,
    TrainerRequestsService,
    TrainerClientsService,
    TrainerEarningsService,
  ],
  exports: [InstructorContextService],
})
export class TrainerAppModule {}
