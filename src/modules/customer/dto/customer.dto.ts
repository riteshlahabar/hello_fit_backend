import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Gender } from '../../../generated/prisma/enums';
import {
  PINCODE_MESSAGE,
  PINCODE_RE,
} from '../../../common/validation/pincode';

/**
 * The shared rule, not a local copy. `common/validation/pincode.ts` exists
 * precisely so the address DTOs, the serviceability lookup and the masters
 * bulk-add cannot drift — a second copy here would accept a code one surface
 * can store and another cannot resolve.
 */
const PINCODE = PINCODE_RE;

/**
 * Every field optional — PATCH semantics.
 *
 * There is no create DTO: `auth.verifyLoginOtp` already inserts the profile row
 * (with an empty name) on first login, so completing it is an update.
 */
export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /**
   * Contact email. PDF §3.2 asks for "update name and contact information";
   * it lives on `User`, not on the profile, and is unique across accounts.
   * The mobile is not editable here — it is the login identity, changed only
   * by verifying a new one.
   */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  /** Calendar date (YYYY-MM-DD). Stored on a @db.Date column. */
  @IsOptional()
  @IsISO8601({ strict: true })
  dob?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  goal?: string;

  /**
   * Conditions, injuries and preferences the teacher must read before arriving.
   * Free text on purpose — a fixed list would hide the one thing that matters.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  healthNotes?: string;

  /** Referral code of the customer who invited this one. Settable once. */
  @IsOptional()
  @IsString()
  @Length(4, 20)
  referredByCode?: string;
}

export class CreateAddressDto {
  /** "Home", "Mum's place", "Office". */
  @IsString()
  @Length(1, 60)
  label!: string;

  @IsString()
  @Length(3, 255)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string;

  @IsOptional()
  @IsUUID()
  cityId?: string;

  /**
   * Service area. Optional here, but assignment filters teachers by it — an
   * address without one can only be matched on radius, so the app should send
   * it whenever the area picker resolves.
   */
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @Matches(PINCODE, { message: PINCODE_MESSAGE })
  pincode!: string;

  /** Drives the distance score and the check-in geo-fence. */
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  /** Gate code, lift, parking, "ring twice" — shown to the teacher en route. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessNotes?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(3, 255)
  line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string;

  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsUUID()
  areaId?: string;

  @IsOptional()
  @Matches(PINCODE, { message: PINCODE_MESSAGE })
  pincode?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessNotes?: string;
}
