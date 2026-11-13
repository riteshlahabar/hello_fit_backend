import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  InstructorStatus,
  KycStatus,
  OnboardingStage,
  SessionFormat,
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
 * Moves an applicant through the pipeline. The reason is mandatory and always
 * recorded: every stage change is an auditable admin action (spec 10.1).
 */
export class ChangeOnboardingStageDto {
  @IsEnum(OnboardingStage)
  stage!: OnboardingStage;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/**
 * Ops-owned scheduling fields, separate from the teacher's own profile PATCH.
 * These are the numbers the slot grid and the clash check run on, so the
 * teacher may not set them.
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

  /** Minutes blocked either side of a session so travel never double-books. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  travelBufferMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  travelRadiusKm?: number;

  /**
   * Where this provider will hold sessions — PDF 5.5's "Session location"
   * filter. Required to be non-empty when sent: an empty array would make the
   * provider invisible to the first filter every visitor touches.
   *
   * Set by ops today because `instructor_app/` is still a bare scaffold; it
   * moves to the provider themselves under §4.5 when that app exists.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(SessionFormat, { each: true })
  sessionFormats?: SessionFormat[];
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
