import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * The contact, address and professional-background half of a provider's
 * profile — the fields the trainer app's onboarding wizard asks for (pages 13,
 * 14 and 18 of the client's HTML pack, 19 Nov 2026).
 *
 * Split out of `UpdateInstructorProfileDto`, which it is the base of, to keep
 * both files short. Every field is optional: the wizard saves one step at a
 * time, and an absent key must leave the column alone.
 */
export class InstructorContactDto {

  /**
   * Written to `User.email`, not the profile — the column already exists there
   * and is unique across the platform.
   */
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  /** Postal address (page 13). Read by people, not by the matcher. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  landmark?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  state?: string;

  /** Same six-digit rule the rest of the platform uses. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  country?: string;

  /** Professional background (page 14). */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  qualification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  institute?: string;

  /** A band such as `11-25`, because the screen asks for a band. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  clientsTrainedBand?: string;

  /** Free-text locality the provider serves (page 18). */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceLocality?: string;

  /** Only meaningful alongside `PROVIDER_LOCATION` (page 18). */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  studioName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  studioAddress?: string;
}
