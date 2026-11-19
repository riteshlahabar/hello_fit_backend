import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { OtpPurpose } from '../../generated/prisma/enums';

/** Spec 10.1 — OTP rate limiting and lockout. All admin-configurable later. */
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
/** How many OTPs one mobile may request inside the window. */
export const OTP_MAX_SENDS_PER_WINDOW = 5;
export const OTP_SEND_WINDOW_MINUTES = 15;
/** Non-production fixed code, so manual app testing needs no SMS. */
export const DEV_FIXED_OTP = '123456';

export type OtpVerifyResult =
  | { ok: true; otpRequestId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'ATTEMPTS_EXCEEDED' | 'MISMATCH' };

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues an OTP. The plain code is returned so the caller can hand it to the
   * SMS provider; only its hash is persisted, so a database leak cannot be
   * replayed. Returns null when the sender is rate limited.
   */
  async issue(
    mobile: string,
    purpose: OtpPurpose,
    requestIp?: string,
  ): Promise<{ code: string; expiresAt: Date } | null> {
    const windowStart = new Date(
      Date.now() - OTP_SEND_WINDOW_MINUTES * 60_000,
    );

    const recentSends = await this.prisma.otpRequest.count({
      where: { mobile, purpose, createdAt: { gte: windowStart } },
    });

    if (recentSends >= OTP_MAX_SENDS_PER_WINDOW) {
      this.logger.warn(`OTP send rate limit hit for ${this.mask(mobile)}`);
      return null;
    }

    // Invalidate any outstanding code so only the newest one works.
    await this.prisma.otpRequest.updateMany({
      where: { mobile, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

    await this.prisma.otpRequest.create({
      data: {
        mobile,
        purpose,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt,
        requestIp,
      },
    });

    return { code, expiresAt };
  }

  /**
   * Verifies and consumes a code. Every failed attempt is counted on the row
   * so a brute-force attempt locks that OTP out after OTP_MAX_ATTEMPTS.
   */
  async verify(
    mobile: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<OtpVerifyResult> {
    const record = await this.prisma.otpRequest.findFirst({
      where: { mobile, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) return { ok: false, reason: 'NOT_FOUND' };

    if (record.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: 'ATTEMPTS_EXCEEDED' };
    }

    const matches = await bcrypt.compare(code, record.codeHash);

    if (!matches) {
      await this.prisma.otpRequest.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, reason: 'MISMATCH' };
    }

    await this.prisma.otpRequest.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return { ok: true, otpRequestId: record.id };
  }

  /** Cryptographically random, not Math.random. */
  private generateCode(): string {
    if (process.env.NODE_ENV !== 'production') {
      return DEV_FIXED_OTP;
    }

    const max = 10 ** OTP_LENGTH;
    return randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
  }

  private mask(mobile: string): string {
    return mobile.length <= 4 ? '****' : `****${mobile.slice(-4)}`;
  }
}
