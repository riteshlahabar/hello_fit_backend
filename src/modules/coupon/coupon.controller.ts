import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { CouponService } from './coupon.service';
import { ValidateCouponDto } from './dto/coupon.dto';

/**
 * The customer-facing half of PDF 6.9 — one route, because US-A09 asks for
 * exactly one thing from the app: "the applicable discount is displayed
 * before payment".
 *
 * There is deliberately **no "available offers" list**. The PDF describes a
 * code the customer enters; a browsable offers screen is not in it.
 */
@Controller('app/customer/coupons')
@AllowAudience('app')
@Roles('CUSTOMER')
export class CouponController {
  constructor(
    private readonly coupons: CouponService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Checks a typed code against the charge and returns the discount. Pure
   * read — reserves nothing, so the code can be checked and abandoned.
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validate(
    @Body() dto: ValidateCouponDto,
    @CurrentUser('id') userId: string,
  ) {
    const customerId = await this.resolveCustomerId(userId);

    return {
      data: await this.coupons.validate(customerId, dto.code, dto.amount),
      message: 'Coupon applied',
    };
  }

  /** The token carries the User id; redemptions are counted per CustomerProfile. */
  private async resolveCustomerId(userId: string): Promise<string> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, isBlocked: true, blockReason: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Complete your profile before booking',
      });
    }

    if (profile.isBlocked) {
      throw new BadRequestException({
        code: ErrorCode.FORBIDDEN,
        message:
          profile.blockReason ??
          'This account cannot make bookings. Contact support.',
      });
    }

    return profile.id;
  }
}
