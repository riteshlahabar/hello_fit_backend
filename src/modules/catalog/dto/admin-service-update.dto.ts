import {
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
} from 'class-validator';
import { ServiceLevel } from '../../../generated/prisma/enums';

/**
 * Editing a service from the admin panel (client instruction, 18 Nov 2026).
 *
 * **Past the v3 PDF on purpose**, the same way the create route is: §4.5
 * gives the provider its service's wording and §6.5 gives the admin review
 * and visibility only. The client asked for the Edit button after the Add
 * button. → `state/scope-documents.md`
 *
 * Every field is optional — the panel sends the whole form, a script may
 * send one key. The rate fields overlap `UpdateServicePricingDto`, which
 * stays for the pricing-only screen; both end at the same column rules.
 */
export class UpdateServiceDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  /** Per session, per person, for `durationMin` minutes. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  basePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  durationMin?: number;

  @IsOptional()
  @IsEnum(ServiceLevel)
  level?: ServiceLevel;

  /**
   * Which percentage system the service uses. False: packages, one person.
   * True: group slabs, no package. Never both.
   */
  @IsOptional()
  @IsBoolean()
  allowMultiPerson?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxParticipants?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  inclusions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  equipment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  isHomeService?: boolean;

  @IsOptional()
  @IsBoolean()
  allowExtension?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
