import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/auth.decorators';

/**
 * Public catalog. Browsing needs no account — the app shows the category grid
 * and service detail before the customer signs in, and only the booking
 * wizard requires a token.
 */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  async categories() {
    return { data: await this.catalog.listCategories() };
  }

  /**
   * The package list behind the website's Package page. Public for the same
   * reason the catalog is: a visitor compares terms before signing in.
   *
   * `serviceId` is optional — without it a package carries its terms and its
   * percentage but no price, because the rate it applies to is the service's.
   */
  @Public()
  @Get('packages')
  async packages(@Query('serviceId', new ParseUUIDPipe({ optional: true })) serviceId?: string) {
    return { data: await this.catalog.listPackages(serviceId) };
  }

  @Public()
  @Get('services')
  async services(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return { data: await this.catalog.listServices({ categoryId, search }) };
  }

  @Public()
  @Get('services/:id')
  async service(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.catalog.getService(id) };
  }

  @Public()
  @Get('services/:id/addons')
  async addons(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.catalog.listAddonsForService(id) };
  }
}
