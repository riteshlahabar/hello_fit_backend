import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EarningStatus, PayoutStatus } from '../../../generated/prisma/enums';

export class ListPayoutsQueryDto {
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  /** Exact cycle start (YYYY-MM-DD), as shown on the payout row. */
  @IsOptional()
  @IsISO8601({ strict: true })
  cycleFrom?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ListEarningsQueryDto {
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  @IsOptional()
  @IsEnum(EarningStatus)
  status?: EarningStatus;

  /** Session-date range, not earning-created range: finance reconciles by when
   *  the work happened. */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * Generates batches for one cycle. With no dates it uses the cycle that most
 * recently closed, which is what the weekly job does — so running it by hand
 * reproduces the job exactly rather than being a different code path.
 */
export class GeneratePayoutsDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  cycleFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  cycleTo?: string;

  /** Limit the run to one teacher — used to re-run a batch that was deleted. */
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  /**
   * Compute and return what *would* be created, writing nothing. Finance asked
   * for this: the batch is money leaving, and seeing the list first is cheaper
   * than deleting drafts afterwards.
   */
  @IsOptional()
  dryRun?: boolean;
}

export class ApprovePayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

/**
 * Records a completed transfer. The UTR is mandatory — it is the only thing
 * that ties our row to the bank statement during a reconciliation dispute.
 */
export class MarkPayoutPaidDto {
  @IsString()
  @MinLength(4)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9/-]+$/, {
    message: 'utr may contain only letters, digits, hyphens and slashes',
  })
  utr!: string;

  /** Defaults to now. Backdated when finance records a transfer made earlier. */
  @IsOptional()
  @IsISO8601()
  paidAt?: string;
}

export class FailPayoutDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** Holds one earning out of every future batch until it is released. */
export class WithholdEarningDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
