import { Module } from '@nestjs/common';
import { AdminCouponController } from './admin-coupon.controller';
import { CouponController } from './coupon.controller';
import { CouponRepository } from './coupon.repository';
import { CouponService } from './coupon.service';
import { AuditModule } from '../audit/audit.module';

/**
 * Coupons and promotional settings (PDF 6.9). Exports CouponService so the
 * booking transaction can validate and redeem a code — the discount is
 * computed server-side, never taken from the client.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminCouponController, CouponController],
  providers: [CouponService, CouponRepository],
  exports: [CouponService],
})
export class CouponModule {}
