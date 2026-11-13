import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DocumentType,
  Gender,
  SessionFormat,
} from '../../../generated/prisma/enums';

/**
 * Starts an application. Deliberately minimal — the long professional profile
 * is a PATCH afterwards, so an applicant who abandons the form halfway is still
 * in the pipeline and can be followed up, rather than vanishing.
 */
export class ApplyAsInstructorDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears?: number;
}

/**
 * The professional profile. All optional (PATCH), but `canSubmitForReview`
 * refuses until name, bio, languages, specialisations and the home base are
 * all filled.
 *
 * Ops-owned fields are **not** here on purpose: branch, daily cap, travel
 * buffer and status are set by admin, and a teacher who could raise their own
 * daily cap or shrink their own travel buffer would quietly break scheduling.
 */
export class UpdateInstructorProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  /**
   * Where this provider will hold sessions — PDF §4.5 is the provider's own
   * "Service Management", so they set this themselves; §5.5's "Session
   * location" filter is what reads it.
   *
   * Non-empty when sent: an empty list would make them unfindable by the
   * first filter most visitors touch. Ops can also set it from the admin
   * panel today, because `instructor_app/` is still a bare scaffold.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(SessionFormat, { each: true })
  sessionFormats?: SessionFormat[];

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /** Calendar date (YYYY-MM-DD). Stored on a @db.Date column. */
  @IsOptional()
  @IsISO8601({ strict: true })
  dob?: string;

  /** Shown on the public teacher profile the customer reads before booking. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears?: number;

  /** Language codes. Feeds the language half of the preference-match score. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(10)
  @Length(2, 20, { each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(20)
  @Length(2, 60, { each: true })
  specialisations?: string[];

  /**
   * Home base the travel radius and the distance score are measured from.
   * Both halves or neither — a half-set coordinate would score as (0, lng).
   */
  @IsOptional()
  @IsLatitude()
  homeBaseLat?: number;

  @IsOptional()
  @IsLongitude()
  homeBaseLng?: number;

  /**
   * How far the teacher is willing to travel. A request, not a guarantee:
   * admin caps it, and `maxDistanceKm` in settings still applies.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  travelRadiusKm?: number;
}

/**
 * Metadata for an upload. The file itself arrives as multipart `file`; these
 * ride alongside as form fields, so every value is a string on the wire and
 * the global ValidationPipe's `transform` converts them.
 */
export class UploadDocumentDto {
  @IsEnum(DocumentType)
  docType!: DocumentType;

  /** PAN, Aadhaar, licence or certificate number, where the type has one. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  number?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  issueDate?: string;

  /**
   * Drives the expiry reminder and the `isEligibleForWork` check. Required for
   * police verification in practice, but that is policy, not shape.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  expiryDate?: string;
}
