import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { UpsertBankAccountDto } from './dto/instructor-bank.dto';
import { formatDateTime } from '../../common/dates/format';

/** What the provider's own app and the admin panel are allowed to read back. */
export interface BankAccountView {
  payoutMethod: string;
  holderName: string | null;
  bankName: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
  accountType: string | null;
  upiId: string | null;
  verified: boolean;
  /** `dd-mm-yyyy HH:mm:ss` — hard rule 4, `state/date-format.md`. */
  updatedAt: string;
}

/** The shape `view` reads — every column nullable, because only one side is set. */
interface BankAccountRow {
  payoutMethod: string;
  holderName: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  accountType: string | null;
  upiId: string | null;
  verifiedAt: Date | null;
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
    const bank = dto.payoutMethod === 'BANK';

    // The side not chosen is nulled rather than left alone: switching to UPI
    // must not leave a stale account number that a payout could still find.
    const data = {
      payoutMethod: dto.payoutMethod,
      holderName: bank ? dto.holderName : null,
      bankName: bank ? dto.bankName : null,
      accountNumber: bank ? dto.accountNumber : null,
      ifsc: bank ? dto.ifsc : null,
      accountType: bank ? (dto.accountType ?? 'SAVINGS') : null,
      upiId: bank ? null : dto.upiId,
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
  private static view(row: BankAccountRow): BankAccountView {
    return {
      payoutMethod: String(row.payoutMethod),
      holderName: row.holderName,
      bankName: row.bankName,
      accountNumberMasked: row.accountNumber
        ? `••••${row.accountNumber.slice(-4)}`
        : null,
      ifsc: row.ifsc,
      accountType: row.accountType === null ? null : String(row.accountType),
      upiId: row.upiId,
      verified: row.verifiedAt !== null,
      updatedAt: formatDateTime(row.updatedAt),
    };
  }
}
