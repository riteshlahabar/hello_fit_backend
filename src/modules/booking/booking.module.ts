import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { NotificationModule } from '../notification/notification.module';
import { AvailabilityModule } from '../availability/availability.module';
import { CouponModule } from '../coupon/coupon.module';
import { AdminBookingController } from './admin-booking.controller';
import { BookingController } from './booking.controller';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingNotifications } from './booking.notifications';
import { BookingService } from './booking.service';
import { PricingResolver } from './pricing.resolver';

@Module({
  imports: [AvailabilityModule, AssignmentModule, CouponModule, NotificationModule],
  controllers: [BookingController, AdminBookingController],
  providers: [
    BookingService,
    BookingExpiryService,
    PricingResolver,
    BookingNotifications,
  ],
  exports: [BookingService, BookingNotifications],
})
export class BookingModule {}
