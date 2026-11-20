
import { Transform } from 'class-transformer';
import { InstructorContactDto } from './instructor-contact.dto';
import { ddMmYyyyToIsoDate } from '../../../common/dates/format';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocumentType, Gender } from '../../../generated/prisma/enums';

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
export class UpdateInstructorProfileDto extends InstructorContactDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /**
   * Calendar date, `dd-mm-yyyy` (hard rule 4). ISO is still accepted while the
   * four surfaces catch up — `ddMmYyyyToIsoDate` normalises the new format and
   * passes the old one through. Stored on a `@db.Date` column either way.
   */
  @IsOptional()
  @Transform(({ value }) => ddMmYyyyToIsoDate(value))
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
