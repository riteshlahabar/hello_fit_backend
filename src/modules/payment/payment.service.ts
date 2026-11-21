import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ErrorCode } from '../../common/errors/error-codes';
import { BookingService } from '../booking/booking.service';
import { WalletService } from '../wallet/wallet.service';
import { InvoiceService } from './invoice.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';
import { devSettlementFor } from './dev-settle';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly wallet: WalletService,
    private readonly invoices: InvoiceService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Creates a gateway order for an unpaid booking. Reuses an existing CREATED
   * payment row rather than opening a second order, so a customer who
   * backgrounds the app and returns does not end up with two orders against
   * one booking.
   */
  async createOrder(customerId: string, bookingId: string) {
    const booking = await this.requireUnpaidBooking(customerId, bookingId);

    if (Number(booking.payable) <= 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'Nothing to pay for this booking. Confirm it from your wallet balance instead.',
      });
    }

    const existing = await this.prisma.payment.findFirst({
      where: { bookingId, status: 'CREATED' },
      orderBy: { createdAt: 'desc' },
    });

    if (existing?.gatewayOrderId) {
      return {
        paymentId: existing.id,
        orderId: existing.gatewayOrderId,
        amount: Number(existing.amount),
        currency: 'INR',
        gateway: this.gateway.name,
      };
    }

    const order = await this.gateway.createOrder({
      amount: Number(booking.payable),
      currency: 'INR',
      receipt: booking.code,
      notes: { bookingId: booking.id, bookingCode: booking.code },
    });

    const payment = await this.prisma.payment.create({
      data: {
        bookingId: booking.id,
        gateway: this.gateway.name === 'RAZORPAY' ? 'RAZORPAY' : 'MANUAL',
        gatewayOrderId: order.orderId,
        amount: Number(booking.payable),
        status: 'CREATED',
      },
    });

    return {
      paymentId: payment.id,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      publicKey: order.publicKey,
      gateway: this.gateway.name,
    };
  }

  /**
   * Settles a booking with no gateway involved, on a machine that has no
   * gateway credentials. A 403 whenever a real gateway is configured — see
   * `dev-settle.ts` for why the signing cannot happen in the browser.
   */
  async devSettle(customerId: string, bookingId: string) {
    const order = await this.createOrder(customerId, bookingId);
    const settlement = devSettlementFor(this.gateway, order.orderId);

    this.logger.warn(
      `Development settlement for booking ${bookingId} — no gateway configured`,
    );

    return this.verifyPayment(customerId, {
      bookingId,
      gatewayOrderId: order.orderId,
      gatewayPaymentId: settlement.gatewayPaymentId,
      signature: settlement.signature,
      idempotencyKey: settlement.idempotencyKey,
    });
  }

  /**
   * Confirms a payment the client reports as complete.
   *
   * Idempotent on `idempotencyKey` (spec 8.1): a retried verify returns the
   * original result instead of charging or confirming twice. The webhook does
   * the same work, so whichever arrives first wins and the other is a no-op.
   */
  async verifyPayment(
    customerId: string,
    input: {
      bookingId: string;
      gatewayOrderId: string;
      gatewayPaymentId: string;
      signature: string;
      idempotencyKey?: string;
    },
  ) {
    if (input.idempotencyKey) {
      const replay = await this.prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, status: true, bookingId: true },
      });

      if (replay) {
        this.logger.log(
          `Idempotent replay for key ${input.idempotencyKey} → payment ${replay.id}`,
        );
        return { paymentId: replay.id, status: replay.status, replayed: true };
      }
    }

    const booking = await this.requireUnpaidBooking(customerId, input.bookingId);

    const payment = await this.prisma.payment.findFirst({
      where: {
        bookingId: booking.id,
        gatewayOrderId: input.gatewayOrderId,
      },
    });

    if (!payment) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'No payment order found for this booking',
      });
    }

    if (payment.status === 'CAPTURED') {
      return { paymentId: payment.id, status: payment.status, replayed: true };
    }

    const details = await this.gateway.verifyPayment({
      orderId: input.gatewayOrderId,
      paymentId: input.gatewayPaymentId,
      signature: input.signature,
    });

    if (details.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          gatewayPaymentId: input.gatewayPaymentId,
          failureReason: 'Signature or capture verification failed',
          rawPayload: details.raw as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
        },
      });

      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Payment could not be verified',
      });
    }

    return this.settle({
      paymentId: payment.id,
      bookingId: booking.id,
      gatewayPaymentId: details.paymentId,
      method: details.method,
      raw: details.raw,
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * Pays entirely from wallet balance — no gateway involved. Used when the
   * customer has enough credit, typically after a refund.
   */
  async payFromWallet(customerId: string, bookingId: string) {
    const booking = await this.requireUnpaidBooking(customerId, bookingId);
    const amount = Number(booking.payable);

    const payment = await this.prisma.$transaction(async (tx) => {
      // Debit first: if the balance is short this throws and nothing else
      // happens.
      await this.wallet.debit(
        {
          customerId,
          amount,
          source: 'BOOKING_PAYMENT',
          referenceType: 'booking',
          referenceId: booking.id,
          reason: `Payment for ${booking.code}`,
        },
        tx,
      );

      return tx.payment.create({
        data: {
          bookingId: booking.id,
          gateway: 'WALLET',
          amount,
          status: 'CAPTURED',
          method: 'wallet',
          paidAt: new Date(),
        },
      });
    });

    const invoice = await this.prisma.$transaction((tx) =>
      this.invoices.createForBooking(tx, {
        id: booking.id,
        taxableValue: Number(booking.payable) - Number(booking.tax),
        tax: Number(booking.tax),
        total: Number(booking.payable),
      }),
    );

    const confirmed = await this.booking.confirmPayment(
      booking.id,
      customerId,
      'SYSTEM',
    );

    return { paymentId: payment.id, status: 'CAPTURED', invoice, ...confirmed };
  }

  /**
   * Shared settlement path for the client verify and the webhook: mark the
   * payment captured, raise the invoice, then confirm the booking (which
   * releases its sessions into the assignment queue).
   */
  private async settle(input: {
    paymentId: string;
    bookingId: string;
    gatewayPaymentId: string;
    method?: string;
    raw: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: input.bookingId },
      select: { id: true, code: true, payable: true, tax: true, customerId: true },
    });

    const { invoice } = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: input.paymentId },
        data: {
          status: 'CAPTURED',
          gatewayPaymentId: input.gatewayPaymentId,
          method: input.method,
          paidAt: new Date(),
          rawPayload: input.raw as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
        },
      });

      const created = await this.invoices.createForBooking(tx, {
        id: booking.id,
        taxableValue: Number(booking.payable) - Number(booking.tax),
        tax: Number(booking.tax),
        total: Number(booking.payable),
      });

      return { invoice: created };
    });

    const confirmed = await this.booking.confirmPayment(
      booking.id,
      booking.customerId,
      'SYSTEM',
    );

    this.logger.log(
      `Payment captured for ${booking.code}: invoice ${invoice.invoiceNo}`,
    );

    return {
      paymentId: input.paymentId,
      status: 'CAPTURED' as const,
      invoice,
      ...confirmed,
    };
  }

  /**
   * Inbound gateway webhook. Signature is checked against the raw body, and
   * every event is recorded in `webhook_events` keyed on the provider's event
   * id — a replayed delivery is stored once and processed once (spec 8.1).
   */
  async handleWebhook(rawBody: string, signature: string) {
    if (!this.gateway.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Rejected webhook with an invalid signature');
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Invalid webhook signature',
      });
    }

    const event = JSON.parse(rawBody) as {
      event?: string;
      payload?: { payment?: { entity?: Record<string, unknown> } };
      id?: string;
    };

    const eventId =
      event.id ??
      (event.payload?.payment?.entity?.id as string | undefined) ??
      `unknown-${Date.now()}`;

    // Dedupe on (provider, eventId). A second delivery hits the unique index
    // and is acknowledged without being processed again.
    const existing = await this.prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: { provider: this.gateway.name, eventId },
      },
      select: { id: true, processedAt: true },
    });

    if (existing?.processedAt) {
      this.logger.log(`Webhook ${eventId} already processed, ignoring`);
      return { received: true, duplicate: true };
    }

    const record =
      existing ??
      (await this.prisma.webhookEvent.create({
        data: {
          provider: this.gateway.name,
          eventId,
          eventType: event.event ?? 'unknown',
          payload: event as never,
          signature,
        },
        select: { id: true, processedAt: true },
      }));

    try {
      await this.processWebhookEvent(event);

      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), attempts: { increment: 1 } },
      });

      return { received: true, duplicate: false };
    } catch (error) {
      // Stored, not swallowed: the row keeps the error and the attempt count
      // so a retry job can pick it up.
      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: {
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      this.logger.error(
        `Webhook ${eventId} processing failed`,
        error instanceof Error ? error.stack : String(error),
      );

      // Acknowledged anyway: the gateway must not retry forever on a bug our
      // side. The stored row is the recovery path.
      return { received: true, duplicate: false, deferred: true };
    }
  }

  private async processWebhookEvent(event: {
    event?: string;
    payload?: { payment?: { entity?: Record<string, unknown> } };
  }): Promise<void> {
    if (event.event !== 'payment.captured') return;

    const entity = event.payload?.payment?.entity;
    if (!entity) return;

    const orderId = entity.order_id as string | undefined;
    const paymentId = entity.id as string | undefined;
    if (!orderId || !paymentId) return;

    const payment = await this.prisma.payment.findFirst({
      where: { gatewayOrderId: orderId },
      select: { id: true, bookingId: true, status: true },
    });

    if (!payment || payment.status === 'CAPTURED') return;

    await this.settle({
      paymentId: payment.id,
      bookingId: payment.bookingId,
      gatewayPaymentId: paymentId,
      method: entity.method as string | undefined,
      raw: entity,
    });
  }

  private async requireUnpaidBooking(customerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId, deletedAt: null },
      select: {
        id: true,
        code: true,
        payable: true,
        tax: true,
        paymentStatus: true,
        holdExpiresAt: true,
      },
    });

    if (!booking) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Booking not found',
      });
    }

    if (booking.paymentStatus === 'PAID') {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_RESOURCE,
        message: 'This booking is already paid',
      });
    }

    if (booking.paymentStatus === 'FAILED') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'This booking expired before payment. Please book the slot again.',
      });
    }

    return booking;
  }
}
