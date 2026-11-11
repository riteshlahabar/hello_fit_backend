import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentState } from '../../../generated/prisma/enums';

/**
 * Filters for the transaction table (PDF 6.7 — "view transaction records",
 * "review payment failures").
 *
 * `q` matches the booking code or either gateway reference, which is what an
 * operator has in front of them when a customer or the gateway's dashboard
 * quotes an id.
 */
export class ListPaymentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsEnum(PaymentState)
  status?: PaymentState;

  /** Only rows the gateway has acknowledged with an id of its own. */
  @IsOptional()
  @IsBoolean()
  hasGatewayRef?: boolean;

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
