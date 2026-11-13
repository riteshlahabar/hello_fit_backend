import { Module } from '@nestjs/common';
import { ProviderSearchController } from './provider-search.controller';
import { ProviderSearchRepository } from './provider-search.repository';
import { ProviderSearchService } from './provider-search.service';

/**
 * The marketplace half of provider discovery (PDF §5.5, §5.6, §3.6): the
 * customer searches and chooses.
 *
 * Separate from `assignment/`, which scores and picks a provider *for* the
 * customer. Both now exist on purpose — the apps still use auto-assign, the
 * website lets the customer choose — and keeping them apart is what stops a
 * ranking weight leaking into a public listing.
 */
@Module({
  controllers: [ProviderSearchController],
  providers: [ProviderSearchService, ProviderSearchRepository],
  exports: [ProviderSearchService],
})
export class ProviderSearchModule {}
