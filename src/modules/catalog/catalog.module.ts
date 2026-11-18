import { Module } from '@nestjs/common';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { CatalogController } from './catalog.controller';
import { AdminGroupSlabController } from './admin-group-slab.controller';
import { AdminGroupSlabService } from './admin-group-slab.service';
import { AdminPackageController } from './admin-package.controller';
import { AdminPackageService } from './admin-package.service';
import { AdminServicePricingService } from './admin-service-pricing.service';
import { AdminServiceCreateService } from './admin-service-create.service';
import { AdminServiceUpdateService } from './admin-service-update.service';
import { AdminServiceController } from './admin-service.controller';
import { AdminCatalogDeleteService } from './admin-catalog-delete.service';
import { CatalogService } from './catalog.service';
import { PricingOptionsService } from './pricing-options';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [
    CatalogController,
    AdminCatalogController,
    AdminServiceController,
    AdminPackageController,
    AdminGroupSlabController,
  ],
  providers: [
    CatalogService,
    AdminCatalogService,
    AdminPackageService,
    AdminGroupSlabService,
    AdminServicePricingService,
    AdminServiceCreateService,
    AdminServiceUpdateService,
    AdminCatalogDeleteService,
    PricingOptionsService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
