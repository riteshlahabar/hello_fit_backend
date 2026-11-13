import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ProviderSearchService } from './provider-search.service';
import { Public } from '../../common/decorators/auth.decorators';
import { SearchProvidersQueryDto } from './dto/provider-search.dto';

/**
 * Public provider search — PDF §5.5 and §5.6, the website's Find a Trainer
 * and Trainer Profile pages.
 *
 * `@Public()` because §5.5 opens with "as a **visitor** or customer": the
 * whole point is that someone can look before they have an account. Only the
 * booking that follows needs a token.
 *
 * Reviews are not embedded in the profile response. §5.6 asks for "ratings and
 * reviews where available", and the review list already has its own public
 * route with its own paging — duplicating it here would mean two shapes for
 * the same thing.
 */
@Controller('providers')
export class ProviderSearchController {
  constructor(private readonly providers: ProviderSearchService) {}

  @Public()
  @Get()
  async search(@Query() query: SearchProvidersQueryDto) {
    const { rows, meta } = await this.providers.search(query);
    return {
      data: rows,
      meta,
      message: meta.empty ? 'No providers match these filters yet' : null,
    };
  }

  @Public()
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.providers.get(id) };
  }
}
