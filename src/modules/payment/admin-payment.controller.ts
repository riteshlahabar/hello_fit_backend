import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  AllowAudience,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { AdminPaymentService } from './admin-payment.service';
import { ListPaymentsQueryDto } from './dto/admin-payment.dto';

/**
 * Payment and transaction management (PDF 6.7).
 *
 * Three routes, all `GET`. 6.7's seven functionalities are all views, and it
 * defers refund initiation to "the selected payment gateway and the agreed
 * refund workflow" — so nothing here mutates. `finance:view` throughout.
 *
 * The gateway's raw response is never serialised; see the service.
 */
@Controller('admin/payments')
@AllowAudience('admin')
export class AdminPaymentController {
  constructor(private readonly payments: AdminPaymentService) {}

  @Get()
  @RequirePermissions('finance:view')
  async list(@Query() query: ListPaymentsQueryDto) {
    const { rows, meta } = await this.payments.list(query);
    return { data: rows, meta };
  }

  /** Count and total per state, over the whole filter — not just this page. */
  @Get('summary')
  @RequirePermissions('finance:view')
  async summary(@Query() query: ListPaymentsQueryDto) {
    return { data: await this.payments.summary(query) };
  }

  /** The payment, the booking's invoice, and any refunds against it. */
  @Get(':id')
  @RequirePermissions('finance:view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.payments.detail(id) };
  }
}
