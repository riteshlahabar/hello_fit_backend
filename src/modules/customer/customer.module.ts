import { Module } from '@nestjs/common';
import { AdminCustomerController } from './admin-customer.controller';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { CustomerRepository } from './customer.repository';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule, AuditModule],
  controllers: [CustomerController, AdminCustomerController],
  providers: [CustomerService, CustomerRepository],
  exports: [CustomerService],
})
export class CustomerModule {}
