import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { UpsertBankAccountDto } from './dto/instructor-bank.dto';

/** What the provider's own app and the admin panel are allowed to read back. */
export interface BankAccountView {
  holderName: string;
  bankName: string;
  accountNumberMasked: string;
  ifsc: string;
  accountType: string;
  upiId: string | null;
  verified: boolean;
  updatedAt: Date;
}

/**
 * The provider's payout destination. Kept out of `InstructorService`, which is
 * already long, and separate because this is the one table holding an account
 * number: everything that touches it lives here.
 */
@Injectable()
export class InstructorBankService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwn(userId: string): Promise<BankAccountView | null> {
    const instructorId = await this.requireInstructorId(userId);
    const row = await this.prisma.instructorBankAccount.findUnique({
      where: { instructorId },
    });
    return row ? InstructorBankService.view(row) : null;
  }

  /**
   * Replaces the account wholesale and drops any previous verification — a
   * changed destination must be re-checked before the next transfer.
   */
  async upsertOwn(
    userId: string,
    dto: UpsertBankAccountDto,
  ): Promise<BankAccountView> {
    const instructorId = await this.requireInstructorId(userId);
    const data = {
      holderName: dto.holderName,
      bankName: dto.bankName,
      accountNumber: dto.accountNumber,
      ifsc: dto.ifsc,
      ...(dto.accountType !== undefined && { accountType: dto.accountType }),
      upiId: dto.upiId ?? null,
      verifiedAt: null,
    };

    const row = await this.prisma.instructorBankAccount.upsert({
      where: { instructorId },
      create: { instructorId, ...data },
      update: data,
    });
    return InstructorBankService.view(row);
  }

  private async requireInstructorId(userId: string): Promise<string> {
    const profile = await this.prisma.instructorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'No instructor profile for this account',
      });
    }
    return profile.id;
  }

  /** Last four digits only — the same rule the app already uses for mobiles. */
  private static view(row: {
    holderName: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    accountType: string;
    upiId: string | null;
    verifiedAt: Date | null;
    updatedAt: Date;
  }): BankAccountView {
    return {
      holderName: row.holderName,
      bankName: row.bankName,
      accountNumberMasked: `••••${row.accountNumber.slice(-4)}`,
      ifsc: row.ifsc,
      accountType: String(row.accountType),
      upiId: row.upiId,
      verified: row.verifiedAt !== null,
      updatedAt: row.updatedAt,
    };
  }
}
