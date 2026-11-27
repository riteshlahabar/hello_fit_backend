import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  InstructorStatus,
  KycStatus,
  OnboardingStage,
  VerifyStatus,
} from '../../../generated/prisma/enums';

/** Filters for the applicant pipeline table. Page/limit, per the convention. */
export class ListInstructorsQueryDto {
  @IsOptional()
  @IsEnum(OnboardingStage)
  stage?: OnboardingStage;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @IsOptional()
  @IsEnum(InstructorStatus)
  status?: InstructorStatus;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Matches name or mobile. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

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
 * Verify or reject one document. A remark is mandatory on rejection — the
 * teacher is told *why*, and "rejected, no reason given" is the single most
 * common support ticket in a KYC flow.
 */
export class VerifyDocumentDto {
  @IsEnum(VerifyStatus)
  verifyStatus!: VerifyStatus;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  remarks?: string;
}

/**
 * Moves an applicant through the pipeline. Every stage change is an auditable
 * admin action (spec 10.1), so whatever note is given is always recorded.
 *
 * **The note is required on a rejection and optional otherwise** (client,
 * 26-11-2026): a rejected applicant must be told why, an approved one needs
 * no explanation. It is still validated whenever it is sent, so an approval
 * note cannot be a stray character.
 */
export class ChangeOnboardingStageDto {
  @IsEnum(OnboardingStage)
  stage!: OnboardingStage;

  @ValidateIf(
    (dto: ChangeOnboardingStageDto) =>
      dto.stage === OnboardingStage.REJECTED || dto.reason !== undefined,
  )
  @IsString({ message: 'A note is required when rejecting an applicant' })
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

/**
 * Ops-owned fields, separate from the teacher's own profile PATCH: the branch,
 * the daily cap the slot grid runs on, the services they are allowed to
 * deliver, and the commission override.
 *
 * **Travel buffer and travel radius are deliberately absent** (client,
 * 20-11-2026 — "remove travel buffer and travel radius"). The columns stay:
 * `travelBufferMin` falls back to `scheduling.defaultTravelBufferMin` and the
 * provider sets their own `travelRadiusKm` from the trainer app. Admin no
 * longer touches either, so there is no field here to touch them with.
 */
export class AdminUpdateInstructorDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  dailySessionCap?: number;

  /**
   * Which services this provider delivers (client, 20-11-2026). **The whole
   * set, not a delta** — an id left out is withdrawn, which is what a
   * multi-select on the Edit dialog means.
   *
   * The admin's pick *is* PDF 6.5's "manage permitted service visibility":
   * what is chosen here is published, and the separate publish/unpublish
   * action is gone from the row menu. Safe because `PUBLIC_PROVIDER` still
   * demands `kycStatus: VERIFIED` before anyone reaches the website.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  serviceIds?: string[];

  /**
   * Per-provider commission override as a percent (client, 19-11-2026).
   * Optional by design: unset, the service's own `commissionPct` applies, and
   * that is the normal case. **Send `null` to clear it** and fall back to the
   * service — which is why this is nullable rather than merely absent-able.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPct?: number | null;
}

/** Approve or revoke one of a provider's service offerings (PDF 6.5). */
export class SetOfferingApprovalDto {
  @IsBoolean()
  approved!: boolean;
}


/** Suspend or blacklist. The reason reaches the teacher and the audit log. */
export class ChangeInstructorStatusDto {
  @IsEnum(InstructorStatus)
  status!: InstructorStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
