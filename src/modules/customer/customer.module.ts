import { Module } from '@nestjs/common';
import { AdminCustomerController } from './admin-customer.controller';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { CustomerPhotoService } from './customer-photo.service';
import { CustomerRepository } from './customer.repository';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [SettingsModule, AuditModule, ServiceabilityModule, StorageModule],
  controllers: [CustomerController, AdminCustomerController],
  providers: [CustomerService, CustomerPhotoService, CustomerRepository],
  exports: [CustomerService],
})
export class CustomerModule {}
