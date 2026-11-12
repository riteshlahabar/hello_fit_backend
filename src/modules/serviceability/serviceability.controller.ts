import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ServiceabilityService } from './serviceability.service';
import { Public } from '../../common/decorators/auth.decorators';
import { ErrorCode } from '../../common/errors/error-codes';
import { PINCODE_MESSAGE, PINCODE_RE } from '../../common/validation/pincode';

/**
 * Public serviceability. A visitor checks whether HelloFit covers their PIN
 * before they have an account — the homepage search bar and the booking
 * address form both ask this ahead of login, which is why neither route is
 * guarded.
 */
@Controller('serviceability')
export class ServiceabilityController {
  constructor(private readonly serviceability: ServiceabilityService) {}

  /**
   * Active areas for a city, or all of them. Needed only when a PIN resolves
   * to more than one area and the customer has to choose.
   */
  @Public()
  @Get('areas')
  async areas(@Query('cityId', new ParseUUIDPipe({ optional: true })) cityId?: string) {
    return { data: await this.serviceability.listAreas(cityId) };
  }

  /** Launched cities, for the profile and checkout city pickers. */
  @Public()
  @Get('cities')
  async cities() {
    return { data: await this.serviceability.listCities() };
  }

  /**
   * Declared after `areas` and `cities` so the literal segments are matched
   * first — Nest
   * resolves routes in declaration order and `:pincode` would otherwise
   * swallow `/areas` and 400 on the PIN check.
   */
  @Public()
  @Get(':pincode')
  async resolve(@Param('pincode') pincode: string) {
    if (!PINCODE_RE.test(pincode)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: PINCODE_MESSAGE,
      });
    }

    return { data: await this.serviceability.resolve(pincode) };
  }
}
