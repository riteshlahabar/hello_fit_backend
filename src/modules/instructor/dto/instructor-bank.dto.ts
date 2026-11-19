import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { BankAccountType } from '../../../generated/prisma/enums';

/** Four letters, a zero, then the branch code. The RBI format. */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian account numbers run 9–18 digits; the column allows 34 for IBANs. */
const ACCOUNT_PATTERN = /^\d{9,18}$/;

const UPI_PATTERN = /^[\w.\-]{2,60}@[A-Za-z]{2,30}$/;

/**
 * The whole payout destination in one body (trainer app page 20).
 *
 * A PUT, not a PATCH: a half-replaced account — new number against an old
 * IFSC — would route money to a real but wrong branch. Send all of it or
 * none of it.
 */
export class UpsertBankAccountDto {
  @IsString()
  @Length(2, 160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  holderName!: string;

  @IsString()
  @Length(2, 160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  bankName!: string;

  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s/g, '') : value,
  )
  @Matches(ACCOUNT_PATTERN, {
    message: 'accountNumber must be 9 to 18 digits',
  })
  accountNumber!: string;

  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(IFSC_PATTERN, { message: 'ifsc must be a valid IFSC code' })
  ifsc!: string;

  @IsOptional()
  @IsEnum(BankAccountType)
  accountType?: BankAccountType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(UPI_PATTERN, { message: 'upiId must look like name@bank' })
  upiId?: string;
}
