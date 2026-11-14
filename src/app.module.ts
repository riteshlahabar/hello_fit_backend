import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env.validation';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { BookingModule } from './modules/booking/booking.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomerModule } from './modules/customer/customer.module';
import { CouponModule } from './modules/coupon/coupon.module';
import { PlanModule } from './modules/plan/plan.module';
import { FavouriteModule } from './modules/favourite/favourite.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminUserModule } from './modules/admin-user/admin-user.module';
import { MastersModule } from './modules/masters/masters.module';
import { ServiceabilityModule } from './modules/serviceability/serviceability.module';
import { ProviderSearchModule } from './modules/provider-search/provider-search.module';
import { InstructorModule } from './modules/instructor/instructor.module';
import { PaymentModule } from './modules/payment/payment.module';
import { PayoutModule } from './modules/payout/payout.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ReviewModule } from './modules/review/review.module';
import { SessionModule } from './modules/session/session.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // Baseline limit; auth routes tighten it with @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    JwtModule.register({}),
    // Drives the unpaid-booking expiry cron; BullMQ replaces the per-booking
    // timing later but this stays as the safety net.
    ScheduleModule.forRoot(),
    PrismaModule,
    SettingsModule,
    AuthModule,
    CustomerModule,
    InstructorModule,
    CatalogModule,
    AvailabilityModule,
    BookingModule,
    AssignmentModule,
    SessionModule,
    WalletModule,
    PaymentModule,
    PayoutModule,
    NotificationModule,
    ReviewModule,
    MastersModule,
    AdminUserModule,
    DashboardModule,
    CouponModule,
    PlanModule,
    FavouriteModule,
    ReportsModule,
    ServiceabilityModule,
    ProviderSearchModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: throttle, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 / path-to-regexp requires a named wildcard; '*' is rejected.
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
