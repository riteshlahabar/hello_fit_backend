import { Module } from '@nestjs/common';
import { AdminInstructorController } from './admin-instructor.controller';
import { DocumentExpiryService } from './document-expiry.service';
import { InstructorBankController } from './instructor-bank.controller';
import { InstructorBankService } from './instructor-bank.service';
import { InstructorOnboardingController } from './instructor-onboarding.controller';
import { InstructorRepository } from './instructor.repository';
import { InstructorService } from './instructor.service';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [SettingsModule, StorageModule, AuditModule, NotificationModule],
  controllers: [
    InstructorOnboardingController,
    InstructorBankController,
    AdminInstructorController,
  ],
  providers: [
    InstructorService,
    InstructorBankService,
    InstructorRepository,
    DocumentExpiryService,
  ],
  exports: [InstructorService],
})
export class InstructorModule {}
