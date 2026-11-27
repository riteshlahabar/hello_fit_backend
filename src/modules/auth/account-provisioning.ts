import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateReferralCode } from '../customer/referral';
import type { UserRole } from '../../generated/prisma/enums';

/**
 * Everything the first OTP login creates, decided by the app signing in.
 *
 * Split out of `auth.service.ts` because registration now branches: the
 * customer app creates a `customer_profiles` row, the trainer app creates an
 * `instructor_profiles` row, and neither creates the other's (client,
 * 27-11-2026). Spec 3.6 had every new account start as CUSTOMER and treated
 * applying to teach as a separate later step, so a trainer who registered in
 * the trainer app landed in the customer list and nowhere else. The client
 * overrode that: a trainer registration belongs in the trainer table.
 *
 * The other profile is still created **on demand** — a trainer who later opens
 * the customer app and signs in gets a customer profile then, because booking
 * needs one. What is gone is creating it for someone who never asked.
 */
export const APP_USER_INCLUDE = {
  customerProfile: { select: { id: true } },
  instructorProfile: { select: { id: true, onboardingStage: true } },
} as const;

/**
 * Profiles made by registration carry no name — the person has typed nothing
 * but a mobile number at that point. The onboarding wizard fills it in
 * (`InstructorService.apply`), and an empty name is how that call knows the
 * row is its own stub rather than a real application to collide with.
 */
export const PROFILE_STUB_NAME = '';

/** The shape `verifyLoginOtp` already holds when it finds an existing user. */
interface ExistingUser {
  id: string;
  roles: UserRole[];
  customerProfile: { id: string } | null;
  instructorProfile: { id: string; onboardingStage: string } | null;
}

@Injectable()
export class AccountProvisioningService {
  private readonly logger = new Logger(AccountProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** First login: one `users` row plus the one profile the caller's app needs. */
  async createAccount(mobile: string, role: UserRole) {
    const user = await this.prisma.user.create({
      data: {
        mobile,
        roles: [role],
        ...(role === 'INSTRUCTOR'
          ? { instructorProfile: { create: { name: PROFILE_STUB_NAME } } }
          : {
              customerProfile: {
                create: {
                  name: PROFILE_STUB_NAME,
                  referralCode: await this.allocateReferralCode(),
                },
              },
            }),
      },
      include: APP_USER_INCLUDE,
    });

    this.logger.log(`Account created user=${user.id} as=${role}`);
    return user;
  }

  /**
   * A returning person signing in from the *other* app. Adds the missing
   * profile and role, leaving the ones they already have alone — the two are
   * not exclusive, and a trainer who also books is one `users` row with both.
   *
   * Returns the user unchanged when nothing is missing, which is the common
   * path and costs no write.
   */
  async ensureProfileFor(user: ExistingUser, role: UserRole) {
    const missing =
      role === 'INSTRUCTOR' ? !user.instructorProfile : !user.customerProfile;

    if (!missing && user.roles.includes(role)) {
      return this.load(user.id);
    }

    await this.prisma.$transaction(async (tx) => {
      if (!user.roles.includes(role)) {
        await tx.user.update({
          where: { id: user.id },
          data: { roles: { set: [...user.roles, role] } },
        });
      }

      if (!missing) return;

      if (role === 'INSTRUCTOR') {
        await tx.instructorProfile.create({
          data: { userId: user.id, name: PROFILE_STUB_NAME },
        });
      } else {
        await tx.customerProfile.create({
          data: {
            userId: user.id,
            name: PROFILE_STUB_NAME,
            referralCode: await this.allocateReferralCode(),
          },
        });
      }
    });

    this.logger.log(`Profile added user=${user.id} as=${role}`);
    return this.load(user.id);
  }

  private load(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: APP_USER_INCLUDE,
    });
  }

  /**
   * Allocates a referral code for a brand-new customer profile.
   *
   * The alphabet lives in `modules/customer/referral.ts` — codes get read
   * aloud and typed back in, so it excludes 0/O and 1/I/L. Retries on the
   * (vanishingly unlikely) unique-code collision rather than trusting the odds.
   */
  private async allocateReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateReferralCode();
      const taken = await this.prisma.customerProfile.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new Error('Could not allocate a unique referral code');
  }
}
