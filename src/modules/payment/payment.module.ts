import { Logger, Module } from '@nestjs/common';
import { AdminPaymentController } from './admin-payment.controller';
import { AdminPaymentService } from './admin-payment.service';
import { ConfigService } from '@nestjs/config';
import { BookingModule } from '../booking/booking.module';
import { WalletModule } from '../wallet/wallet.module';
import { ManualGateway } from './gateway/manual.gateway';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway';
import { RazorpayGateway } from './gateway/razorpay.gateway';
import { InvoiceService } from './invoice.service';
import { PaymentController, WebhookController } from './payment.controller';
import { PaymentService } from './payment.service';
import { RefundService } from './refund.service';
import type { EnvVars } from '../../config/env.validation';

/**
 * Picks the gateway from configuration. Razorpay when credentials exist,
 * otherwise the development stand-in — and in production a missing key is a
 * boot failure rather than a silent fallback to a fake gateway.
 */
const gatewayProvider = {
  provide: PAYMENT_GATEWAY,
  inject: [ConfigService, RazorpayGateway, ManualGateway],
  useFactory: (
    config: ConfigService<EnvVars, true>,
    razorpay: RazorpayGateway,
    manual: ManualGateway,
  ) => {
    const logger = new Logger('PaymentGateway');
    const configured = Boolean(
      config.get('RAZORPAY_KEY_ID', { infer: true }) &&
        config.get('RAZORPAY_KEY_SECRET', { infer: true }),
    );

    if (configured) {
      logger.log('Using Razorpay');
      return razorpay;
    }

    if (config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error(
        'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production',
      );
    }

    logger.warn(
      'No Razorpay credentials — using the development gateway. Payments are simulated.',
    );
    return manual;
  },
};

@Module({
  imports: [BookingModule, WalletModule],
  controllers: [AdminPaymentController, PaymentController, WebhookController],
  providers: [
    AdminPaymentService,
    PaymentService,
    RefundService,
    InvoiceService,
    RazorpayGateway,
    ManualGateway,
    gatewayProvider,
  ],
  exports: [PaymentService, RefundService],
})
export class PaymentModule {}
