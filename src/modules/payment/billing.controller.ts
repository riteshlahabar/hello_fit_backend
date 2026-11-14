import { Controller, Get, Query } from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { BillingService } from './billing.service';
import { ListBillingDto } from './dto/billing.dto';

/**
 * The customer's own invoices and refunds — Billing History and Refunds.
 *
 * Separate from `PaymentController` (already 261 lines) but on the same
 * `app/customer` prefix, so `invoices` sits next to the existing
 * `invoices/:bookingId` rather than inventing a second customer namespace.
 *
 * **Both routes are read-only.** Nothing here raises an invoice or starts a
 * refund: an invoice is written by `InvoiceService` when a payment settles,
 * and a refund by `RefundService` when a session is cancelled. A page that
 * could create either would be a second, competing source of money records.
 */
@Controller('app/customer')
@AllowAudience('app')
@Roles('CUSTOMER')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Billing History. Newest invoice first. */
  @Get('invoices')
  async invoices(
    @Query() query: ListBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    const { rows, meta } = await this.billing.listInvoices(
      userId,
      query.page ?? 1,
    );

    return {
      data: rows,
      meta,
      message: meta.empty ? 'No invoices yet' : null,
    };
  }

  /**
   * Refunds raised against this customer's bookings.
   *
   * An empty list is `[]` with a message, never a 404 — "you have never had a
   * refund" is the normal state of a healthy account, not an error.
   */
  @Get('refunds')
  async refunds(
    @Query() query: ListBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    const { rows, meta } = await this.billing.listRefunds(
      userId,
      query.page ?? 1,
    );

    return {
      data: rows,
      meta,
      message: meta.empty ? 'No refund requests yet' : null,
    };
  }
}
