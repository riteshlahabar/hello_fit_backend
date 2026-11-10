import { Logger, Module } from '@nestjs/common';
import { AdminPayoutController } from './admin-payout.controller';
import { InstructorPayoutController } from './instructor-payout.controller';
import { ManualPayoutGateway } from './gateway/manual-payout.gateway';
import { PAYOUT_GATEWAY } from './gateway/payout-gateway';
import { PayoutBatchService } from './payout-batch.service';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * Picks the payout rail.
 *
 * Unlike `PaymentModule`, the manual gateway is a **legitimate production
 * choice**, not a development stand-in: the spec requires finance approval
 * before any transfer, so a human is in the loop regardless, and recording the
 * UTR by hand is how the first release settles. RazorpayX slots in here as a
 * second implementation when the account exists — hence no production guard.
 */
const gatewayProvider = {
  provide: PAYOUT_GATEWAY,
  inject: [ManualPayoutGateway],
  useFactory: (manual: ManualPayoutGateway) => {
    new Logger('PayoutGateway').log(
      'Using manual payouts — finance transfers and records the UTR',
    );
    return manual;
  },
};

@Module({
  imports: [SettingsModule, AuditModule, NotificationModule],
  controllers: [AdminPayoutController, InstructorPayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutBatchService,
    ManualPayoutGateway,
    gatewayProvider,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
