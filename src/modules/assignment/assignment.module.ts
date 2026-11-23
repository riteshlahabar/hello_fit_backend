import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { NotificationModule } from '../notification/notification.module';
import { AdminAssignmentController } from './admin-assignment.controller';
import { AssignmentNotifications } from './assignment.notifications';
import { AssignmentService } from './assignment.service';
import { OfferExpiryService } from './offer-expiry.service';

@Module({
  imports: [AvailabilityModule, NotificationModule],
  controllers: [AdminAssignmentController],
  providers: [AssignmentService, OfferExpiryService, AssignmentNotifications],
  exports: [AssignmentService],
})
export class AssignmentModule {}
