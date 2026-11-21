import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  AllowAudience,
  CurrentUser,
  Public,
  Roles,
} from '../../common/decorators/auth.decorators';
import { WalletService } from '../wallet/wallet.service';
import { PaymentService } from './payment.service';
import { RefundService } from './refund.service';

export class CreateOrderDto {
  @IsUUID()
  bookingId!: string;
}

export class VerifyPaymentDto {
  @IsUUID()
  bookingId!: string;

  @IsString()
  @IsNotEmpty()
  gatewayOrderId!: string;

  @IsString()
  @IsNotEmpty()
  gatewayPaymentId!: string;

  @IsString()
  @IsNotEmpty()
  signature!: string;

  /** Supplied by the client so a retried verify cannot double-settle. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class CancelSessionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;

  @IsOptional()
  @IsIn(['WALLET', 'SOURCE'])
  mode?: 'WALLET' | 'SOURCE';
}

/** Customer payments, wallet and cancellations. */
@Controller('app/customer')
@AllowAudience('app')
@Roles('CUSTOMER')
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('payments/order')
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    return { data: await this.payments.createOrder(customerId, dto.bookingId) };
  }

  @Post('payments/verify')
  async verify(
    @Body() dto: VerifyPaymentDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    const result = await this.payments.verifyPayment(customerId, dto);

    return { data: result, message: 'Payment confirmed' };
  }

  /**
   * Development only: settles the booking with no gateway, for a machine
   * that has no gateway credentials. 403 as soon as a real one is configured.
   */
  @Post('payments/dev-settle')
  async devSettle(
    @Body() dto: CreateOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    const result = await this.payments.devSettle(customerId, dto.bookingId);

    return { data: result, message: 'Payment confirmed (development gateway)' };
  }

  /** Pay the whole booking from wallet balance, no gateway involved. */
  @Post('payments/wallet')
  async payFromWallet(
    @Body() dto: CreateOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    const result = await this.payments.payFromWallet(customerId, dto.bookingId);

    return { data: result, message: 'Paid from wallet' };
  }

  @Get('wallet')
  async walletBalance(@CurrentUser('id') userId: string) {
    const customerId = await this.customerId(userId);

    return {
      data: {
        balance: await this.wallet.balanceOf(customerId),
        currency: 'INR',
      },
    };
  }

  @Get('wallet/transactions')
  async walletTransactions(@CurrentUser('id') userId: string) {
    const customerId = await this.customerId(userId);
    const rows = await this.wallet.transactions(customerId);

    return { data: rows, meta: { count: rows.length } };
  }

  /** What cancelling would refund, before the customer commits. */
  @Get('sessions/:id/cancellation-preview')
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);
    return { data: await this.refunds.previewCancellation(customerId, id) };
  }

  @Post('sessions/:id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSessionDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);

    // Ownership check before anything else: cancelSession works by session
    // id alone, so the guard has to happen here.
    const owned = await this.prisma.bookingSession.count({
      where: { id, booking: { customerId }, deletedAt: null },
    });

    if (owned === 0) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Session not found',
      });
    }

    const result = await this.refunds.cancelSession({
      sessionId: id,
      cancelledBy: 'CUSTOMER',
      actorId: customerId,
      actorType: 'CUSTOMER',
      reason: dto.reason,
      mode: dto.mode,
    });

    return { data: result, message: 'Session cancelled' };
  }

  @Get('invoices/:bookingId')
  async invoice(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.customerId(userId);

    const invoice = await this.prisma.invoice.findFirst({
      where: { bookingId, booking: { customerId } },
      select: {
        id: true,
        invoiceNo: true,
        taxableValue: true,
        taxBreakup: true,
        total: true,
        pdfUrl: true,
        issuedAt: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'No invoice for this booking yet',
      });
    }

    return { data: invoice };
  }

  private async customerId(userId: string): Promise<string> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Complete your profile first',
      });
    }

    return profile.id;
  }
}

/**
 * Gateway webhooks. Public because the gateway has no JWT, authenticated
 * instead by the HMAC over the raw body — which is why `rawBody` must be
 * preserved in main.ts.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Public()
  @Post('razorpay')
  async razorpay(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    if (!signature) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Missing signature header',
      });
    }

    const raw = request.rawBody?.toString('utf8');

    if (!raw) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Raw body unavailable — cannot verify signature',
      });
    }

    return { data: await this.payments.handleWebhook(raw, signature) };
  }
}
