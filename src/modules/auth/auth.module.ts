import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController, AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { AccountProvisioningService } from './account-provisioning';

/**
 * JwtModule is registered without a secret on purpose: access and refresh
 * tokens use different secrets, so each sign/verify call passes its own.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, AdminAuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    AccountProvisioningService,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
