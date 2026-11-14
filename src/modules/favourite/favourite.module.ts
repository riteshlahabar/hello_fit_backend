import { Module } from '@nestjs/common';
import { FavouriteController } from './favourite.controller';
import { FavouriteRepository } from './favourite.repository';
import { FavouriteService } from './favourite.service';

/**
 * Saved trainers — client instruction, 13 Nov 2026; not in the v3 PDF.
 * No AuditModule: a customer saving a trainer is not an administrative act.
 */
@Module({
  controllers: [FavouriteController],
  providers: [FavouriteService, FavouriteRepository],
  exports: [FavouriteService],
})
export class FavouriteModule {}
