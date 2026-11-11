import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { AvailabilityModule } from '../availability/availability.module';
import { CouponModule } from '../coupon/coupon.module';
import { AdminBookingController } from './admin-booking.controller';
import { BookingController } from './booking.controller';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingService } from './booking.service';

@Module({
  imports: [AvailabilityModule, AssignmentModule, CouponModule],
  controllers: [BookingController, AdminBookingController],
  providers: [BookingService, BookingExpiryService],
  exports: [BookingService],
})
export class BookingModule {}
