import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * The rate card for a service (client, 17 Nov 2026, restated strictly).
 *
 * **Admin sets every price; a provider never does.** PDF 4.5 and US-P06 read
 * the other way, so this route is a deliberate, client-instructed override of
 * the PDF — see `state/pricing-rules.md`. `InstructorService.customPrice` was
 * dropped in the same change, so the price a customer sees in search is by
 * construction the price charged at checkout.
 */
export class UpdateServicePricingDto {
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

  /**
   * Which percentage system the service uses. False: packages, one person.
   * True: group slabs, no package. Never both.
   */
  @IsOptional()
  @IsBoolean()
  allowMultiPerson?: boolean;

  /** Ceiling on the group-size dropdown. Only read when allowMultiPerson. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxParticipants?: number;
}
