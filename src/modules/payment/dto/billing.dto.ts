import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Paging for Billing History and Refunds.
 *
 * `page` only — neither list takes a `limit` from the client. The page size is
 * the service's business: a customer asking for 10,000 invoices in one request
 * is a denial-of-service shape, not a feature, and the design paginates at a
 * fixed size anyway.
 *
 * Typed as a number and validated with `@IsInt`, which is safe here because
 * `enableImplicitConversion` turns `?page=2` into `2`. That same conversion is
 * a trap for **booleans** (`?isActive=false` arrives as `true`) — see
 * `state/gotchas.md`. There is no boolean query param on these two routes.
 */
export class ListBillingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;
}
