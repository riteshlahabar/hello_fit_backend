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
 * Creating a service from the admin panel (client instruction, 18 Nov 2026).
 *
 * **This goes past the v3 PDF**, which gives service creation to the provider
 * (§4.5) and the admin only review and visibility (§6.5). The client asked
 * for the button anyway, the same way admin-only pricing overrode §4.5 on
 * 17 Nov. → `state/scope-documents.md`, `state/pricing-rules.md`
 *
 * The rate fields repeat `UpdateServicePricingDto` because a service cannot
 * exist without a price: `basePrice` is what every percent is applied to.
 */
export class CreateServiceDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  /** Per session, per person, for `durationMin` minutes. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  basePrice!: number;

  @IsInt()
  @Min(15)
  @Max(480)
  durationMin!: number;

  @IsOptional()
  @IsEnum(ServiceLevel)
  level?: ServiceLevel;

  /**
   * Which percentage system the service uses. False: packages, one person.
   * True: group slabs, no package. Never both — the service rejects a group
   * size above `maxParticipants` and a package on a group service.
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
