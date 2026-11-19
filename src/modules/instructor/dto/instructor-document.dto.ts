import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DocumentType } from '../../../generated/prisma/enums';
import { ddMmYyyyToIsoDate } from '../../../common/dates/format';

/**
 * Metadata for an upload. The file itself arrives as multipart `file`; these
 * ride alongside as form fields, so every value is a string on the wire and
 * the global ValidationPipe's `transform` converts them.
 *
 * Both date fields take `dd-mm-yyyy` **and** the ISO they took before (hard
 * rule 4, `state/date-format.md`): the `@Transform` rewrites a dd-mm-yyyy
 * value and passes anything else through for `@IsISO8601` to judge. The same
 * pair guards `dob` on `UpdateInstructorProfileDto`.
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
  @Transform(({ value }) => ddMmYyyyToIsoDate(value))
  @IsISO8601({ strict: true })
  issueDate?: string;

  /**
   * Drives the expiry reminder and the `isEligibleForWork` check. Required for
   * police verification in practice, but that is policy, not shape.
   */
  @IsOptional()
  @Transform(({ value }) => ddMmYyyyToIsoDate(value))
  @IsISO8601({ strict: true })
  expiryDate?: string;
}
