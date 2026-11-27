import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  AccessTokenPayload,
  Audience,
} from '../../common/auth/auth.types';
import { OtpService } from './otp.service';
import { TokenService, type TokenPair } from './token.service';
import type {
  AdminLoginDto,
  DeviceInfoDto,
  SendOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { UserStatus, type UserRole } from '../../generated/prisma/enums';
import {
  AccountProvisioningService,
  APP_USER_INCLUDE,
} from './account-provisioning';

/** What the app needs to decide which shell to load (spec 6.1). */
export interface AppSession extends TokenPair {
  user: {
    id: string;
    mobile: string;
    roles: UserRole[];
    language: string;
    isNewAccount: boolean;
    hasCustomerProfile: boolean;
    hasInstructorProfile: boolean;
    /** Null unless the person has applied to teach. */
    instructorOnboardingStage: string | null;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly accounts: AccountProvisioningService,
  ) {}

  /**
   * Sends a login OTP. Deliberately does not reveal whether the number is
   * registered — the same response either way, so the endpoint cannot be used
   * to enumerate customers.
   */
  async sendLoginOtp(
    dto: SendOtpDto,
    requestIp?: string,
  ): Promise<{ sent: boolean; expiresAt: Date | null; devCode?: string }> {
    const issued = await this.otp.issue(dto.mobile, 'LOGIN', requestIp);

    if (!issued) {
      throw new ForbiddenException({
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many OTP requests. Please try again later.',
      });
    }

    // TODO(notification module): dispatch via MSG91/Twilio. Until that exists
    // the code is logged in development only, never in production.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(`OTP for ${dto.mobile}: ${issued.code}`);
    }

    return {
      sent: true,
      expiresAt: issued.expiresAt,
      ...(process.env.NODE_ENV === 'development'
        ? { devCode: issued.code }
        : {}),
    };
  }

  /**
   * Verifies the OTP and signs the person in, creating the account on first
   * login. Which profile that account gets follows `dto.role` — the trainer
   * app sends INSTRUCTOR, everything else defaults to CUSTOMER
   * (`account-provisioning.ts`).
   */
  async verifyLoginOtp(
    dto: VerifyOtpDto,
    requestIp?: string,
  ): Promise<AppSession> {
    const result = await this.otp.verify(dto.mobile, 'LOGIN', dto.code);

    if (!result.ok) {
      switch (result.reason) {
        case 'EXPIRED':
          throw new UnauthorizedException({
            code: ErrorCode.OTP_EXPIRED,
            message: 'This code has expired. Please request a new one.',
          });
        case 'ATTEMPTS_EXCEEDED':
          throw new UnauthorizedException({
            code: ErrorCode.OTP_ATTEMPTS_EXCEEDED,
            message: 'Too many incorrect attempts. Please request a new code.',
          });
        default:
          throw new UnauthorizedException({
            code: ErrorCode.OTP_INVALID,
            message: 'Incorrect code.',
          });
      }
    }

    const existing = await this.prisma.user.findUnique({
      where: { mobile: dto.mobile },
      include: APP_USER_INCLUDE,
    });

    if (existing && existing.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: ErrorCode.ACCOUNT_SUSPENDED,
        message:
          existing.suspendReason ??
          'This account is not active. Please contact support.',
      });
    }

    // Which app is calling decides which profile exists after this. Omitted
    // means CUSTOMER, so the customer app, the website and older trainer
    // builds all behave as before.
    const role: UserRole = dto.role ?? 'CUSTOMER';

    const user = existing
      ? await this.accounts.ensureProfileFor(existing, role)
      : await this.accounts.createAccount(dto.mobile, role);

    if (dto.device) {
      await this.registerDevice(user.id, dto.device);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const pair = await this.tokens.issuePair(
      {
        sub: user.id,
        aud: 'app',
        roles: user.roles,
        deviceId: dto.device?.deviceId,
      },
      dto.device?.deviceId,
    );

    this.logger.log(
      `App login ${existing ? 'returning' : 'new'} user=${user.id} ip=${requestIp ?? 'unknown'}`,
    );

    return {
      ...pair,
      user: {
        id: user.id,
        mobile: user.mobile,
        roles: user.roles,
        language: user.language,
        isNewAccount: !existing,
        hasCustomerProfile: Boolean(user.customerProfile),
        hasInstructorProfile: Boolean(user.instructorProfile),
        instructorOnboardingStage:
          user.instructorProfile?.onboardingStage ?? null,
      },
    };
  }

  /** Admin panel login. 2FA is accepted in the schema but enforced later. */
  async adminLogin(dto: AdminLoginDto): Promise<TokenPair> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { email: dto.email, deletedAt: null },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });

    // Compare against a dummy hash when the user is absent so a missing
    // account and a wrong password take the same time to answer.
    const hash = admin?.passwordHash ?? DUMMY_HASH;
    const matches = await bcrypt.compare(dto.password, hash);

    if (!admin || !matches) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Incorrect email or password',
      });
    }

    if (admin.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: ErrorCode.ACCOUNT_SUSPENDED,
        message: 'This admin account is not active.',
      });
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`Admin login ${admin.id} role=${admin.role.slug}`);

    return this.tokens.issuePair({
      sub: admin.id,
      aud: 'admin',
      roles: [],
      role: admin.role.slug,
      perms: admin.role.rolePermissions.map(
        (rp) => `${rp.permission.module}:${rp.permission.action}`,
      ),
      branchId: admin.branchId,
    });
  }

  /** Rotates the refresh pair, rebuilding claims so revoked access is dropped. */
  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, (subjectId, audience) =>
      this.buildPayload(subjectId, audience),
    );
  }

  async logout(refreshToken: string, deviceId?: string): Promise<void> {
    await this.tokens.revoke(refreshToken);

    if (deviceId) {
      await this.prisma.device.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: new Date(), fcmToken: null },
      });
    }
  }

  /**
   * Rebuilt on every refresh rather than copied from the old token, so a role
   * or permission change takes effect within one access-token lifetime.
   */
  private async buildPayload(
    subjectId: string,
    audience: Audience,
  ): Promise<AccessTokenPayload> {
    if (audience === 'admin') {
      const admin = await this.prisma.adminUser.findFirst({
        where: { id: subjectId, deletedAt: null },
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } },
          },
        },
      });

      if (!admin || admin.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException({
          code: ErrorCode.UNAUTHENTICATED,
          message: 'Account is no longer active',
        });
      }

      return {
        sub: admin.id,
        aud: 'admin',
        roles: [],
        role: admin.role.slug,
        perms: admin.role.rolePermissions.map(
          (rp) => `${rp.permission.module}:${rp.permission.action}`,
        ),
        branchId: admin.branchId,
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: subjectId, deletedAt: null },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Account is no longer active',
      });
    }

    return { sub: user.id, aud: 'app', roles: user.roles };
  }

  private async registerDevice(
    userId: string,
    device: DeviceInfoDto,
  ): Promise<void> {
    await this.prisma.device.upsert({
      where: { userId_deviceId: { userId, deviceId: device.deviceId } },
      create: {
        userId,
        platform: device.platform,
        deviceId: device.deviceId,
        fcmToken: device.fcmToken,
        appVersion: device.appVersion,
        lastSeenAt: new Date(),
      },
      update: {
        platform: device.platform,
        fcmToken: device.fcmToken,
        appVersion: device.appVersion,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
    });
  }
}

/** A real bcrypt hash of a random value, used only for timing equalisation. */
const DUMMY_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
