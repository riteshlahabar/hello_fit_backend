import { Injectable, Logger } from '@nestjs/common';
import type {
  PayoutGateway,
  PayoutTransferRequest,
  PayoutTransferResult,
} from './payout-gateway';

/**
 * Bank-portal payouts: finance exports the approved batch, moves the money in
 * their own banking software, and records the UTR back here.
 *
 * This is not a stub standing in for a missing integration — it is how the
 * first release actually works, and it is safe to run in production. The spec
 * requires finance approval before any transfer anyway, so a human is in the
 * loop regardless; automating the last step with RazorpayX is an optimisation,
 * a second implementation of this port.
 *
 * It therefore returns `INITIATED`, never `PAID`: claiming the money moved when
 * no API was called would be a lie the payout status is then built on.
 */
@Injectable()
export class ManualPayoutGateway implements PayoutGateway {
  readonly name = 'manual';
  readonly isAutomated = false;

  private readonly logger = new Logger(ManualPayoutGateway.name);

  transfer(request: PayoutTransferRequest): Promise<PayoutTransferResult> {
    this.logger.log(
      `Payout ${request.reference} marked for manual transfer: ` +
        `${request.currency} ${request.amount} to ${request.beneficiary.name}`,
    );

    return Promise.resolve({
      transferId: null,
      status: 'INITIATED',
    });
  }
}
