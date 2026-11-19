import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DocumentType } from '../../../generated/prisma/enums';

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
