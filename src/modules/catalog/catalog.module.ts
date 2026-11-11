import { Module } from '@nestjs/common';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [CatalogController, AdminCatalogController],
  providers: [CatalogService, AdminCatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
