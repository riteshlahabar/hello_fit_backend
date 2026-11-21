import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PaymentGateway } from './gateway/payment-gateway';

/**
 * Completing a payment on a machine with no gateway credentials.
 *
 * **The problem.** With no `RAZORPAY_*` in the environment `PaymentModule`
 * binds `ManualGateway`, which answers `createOrder` with
 * `publicKey: 'dev_key'` and `order_dev_…`. The website never looked at
 * `order.gateway`, so it loaded the real `checkout.razorpay.com` with that
 * fake key and the payment died there — "make payment not work" (client,
 * 21 Nov 2026). Every developer and reviewer hit it.
 *
 * **Why the browser cannot do this itself.** `ManualGateway.verifyPayment`
 * accepts only the signature that gateway would produce, which is an HMAC
 * over a fixed development secret. The smoke suites sign with it because they
 * run on the server's own machine; a browser would need the secret shipped
 * into the client bundle, and a secret in a bundle is a secret no longer —
 * even a development one, because it would also be in the production bundle
 * of any build that forgot to set the real keys.
 *
 * So the signing stays on the server, behind a route that **refuses to work
 * at all unless the active gateway is the development one**. Production binds
 * Razorpay (`PaymentModule` throws at boot without its keys), so there this
 * is a 403 and nothing else.
 */
interface SignableGateway extends PaymentGateway {
  sign(payload: string): string;
}

const hasSign = (gateway: PaymentGateway): gateway is SignableGateway =>
  typeof (gateway as SignableGateway).sign === 'function';

export interface DevSettlement {
  gatewayPaymentId: string;
  signature: string;
  idempotencyKey: string;
}

/**
 * The payment id and signature a development settlement needs, or a 403 when
 * the gateway in use is a real one.
 */
export function devSettlementFor(
  gateway: PaymentGateway,
  orderId: string,
): DevSettlement {
  if (gateway.name !== 'MANUAL' || !hasSign(gateway)) {
    throw new ForbiddenException({
      code: ErrorCode.FORBIDDEN,
      message:
        'This endpoint exists only when no payment gateway is configured. Complete the payment through the gateway.',
    });
  }

  const gatewayPaymentId = `pay_dev_${randomUUID().replace(/-/g, '').slice(0, 14)}`;

  return {
    gatewayPaymentId,
    signature: gateway.sign(`${orderId}|${gatewayPaymentId}`),
    // Keyed on the payment, so a retried settle cannot pay twice — the same
    // rule the real verify follows.
    idempotencyKey: `dev-${gatewayPaymentId}`,
  };
}
