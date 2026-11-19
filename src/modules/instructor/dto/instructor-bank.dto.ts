import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  BankAccountType,
  PayoutMethod,
} from '../../../generated/prisma/enums';

/** Four letters, a zero, then the branch code. The RBI format. */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian account numbers run 9–18 digits; the column allows 34 for IBANs. */
const ACCOUNT_PATTERN = /^\d{9,18}$/;

const UPI_PATTERN = /^[\w.\-]{2,60}@[A-Za-z]{2,30}$/;

const isBank = (o: UpsertBankAccountDto) => o.payoutMethod === PayoutMethod.BANK;
const isUpi = (o: UpsertBankAccountDto) => o.payoutMethod === PayoutMethod.UPI;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The whole payout destination in one body (trainer app page 20).
 *
 * A PUT, not a PATCH: a half-replaced account — new number against an old
 * IFSC — would route money to a real but wrong branch. Send all of it or
 * none of it.
 *
 * `payoutMethod` is a radio (client, 19 Nov 2026): the chosen side is
 * compulsory and the other side is cleared by the service, so a provider who
 * switches from bank to UPI does not leave a stale account number behind.
 */
export class UpsertBankAccountDto {
  @IsEnum(PayoutMethod)
  payoutMethod!: PayoutMethod;

  @ValidateIf(isBank)
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  holderName!: string;

  @ValidateIf(isBank)
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  bankName!: string;

  @ValidateIf(isBank)
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s/g, '') : value,
  )
  @Matches(ACCOUNT_PATTERN, {
    message: 'accountNumber must be 9 to 18 digits',
  })
  accountNumber!: string;

  @ValidateIf(isBank)
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(IFSC_PATTERN, { message: 'ifsc must be a valid IFSC code' })
  ifsc!: string;

  @ValidateIf(isBank)
  @IsOptional()
  @IsEnum(BankAccountType)
  accountType?: BankAccountType;

  @ValidateIf(isUpi)
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(UPI_PATTERN, { message: 'upiId must look like name@bank' })
  upiId!: string;
}
