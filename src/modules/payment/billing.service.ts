import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { BillingRepository } from './billing.repository';
import { toInvoiceRow, toRefundRow } from './billing.view';

/** Page size for both lists. The design shows four rows and paginates. */
const PAGE_SIZE = 20;

/**
 * Billing History and Refunds — the customer's own read-only money trail.
 *
 * Phase 4, 13 Nov 2026. **No new tables**: `Invoice` and `Refund` have existed
 * since the money phase, and both pages were static demos reading nothing.
 */
@Injectable()
export class BillingService {
  constructor(private readonly repo: BillingRepository) {}

  async listInvoices(userId: string, page: number) {
    const customerId = await this.customerId(userId);
    const skip = (page - 1) * PAGE_SIZE;

    const [rows, total] = await Promise.all([
      this.repo.findInvoices(customerId, skip, PAGE_SIZE),
      this.repo.countInvoices(customerId),
    ]);

    return {
      rows: rows.map(toInvoiceRow),
      meta: this.pageMeta(page, total),
    };
  }

  async listRefunds(userId: string, page: number) {
    const customerId = await this.customerId(userId);
    const skip = (page - 1) * PAGE_SIZE;

    const [rows, total] = await Promise.all([
      this.repo.findRefunds(customerId, skip, PAGE_SIZE),
      this.repo.countRefunds(customerId),
    ]);

    return {
      rows: rows.map(toRefundRow),
      meta: this.pageMeta(page, total),
    };
  }

  private pageMeta(page: number, total: number) {
    return {
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      empty: total === 0,
    };
  }

  /**
   * The signed-in user's customer profile id.
   *
   * Duplicated from `PaymentController.customerId` on purpose: that one is
   * private to a 261-line controller, and importing a controller into a
   * service to reach it would invert the dependency.
   */
  private async customerId(userId: string): Promise<string> {
    const profile = await this.repo.customerByUserId(userId);

    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Complete your profile first',
      });
    }

    return profile.id;
  }
}
