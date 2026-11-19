import { Module } from '@nestjs/common';
import { AdminInstructorController } from './admin-instructor.controller';
import { AdminInstructorDecisionsController } from './admin-instructor-decisions.controller';
import { AdminInstructorManageService } from './admin-instructor-manage.service';
import { AdminInstructorReviewService } from './admin-instructor-review.service';
import { AdminInstructorService } from './admin-instructor.service';
import { DocumentExpiryService } from './document-expiry.service';
import { InstructorBankController } from './instructor-bank.controller';
import { InstructorBankService } from './instructor-bank.service';
import { InstructorDocumentService } from './instructor-document.service';
import { InstructorOnboardingController } from './instructor-onboarding.controller';
import { InstructorProfileLookup } from './instructor-profile.lookup';
import { InstructorRepository } from './instructor.repository';
import { InstructorService } from './instructor.service';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';

/**
 * Teacher onboarding, KYC and the verification pipeline (spec 3.6, 5.2).
 *
 * `InstructorService` was one 859-line file; it is now five services around a
 * shared `InstructorProfileLookup` and the pure `instructor-view.ts`, split by
 * audience — the teacher's own profile, the teacher's documents, and the three
 * admin sides. Nothing outside this module injects any of them.
 */
@Module({
  imports: [SettingsModule, StorageModule, AuditModule, NotificationModule],
  controllers: [
    InstructorOnboardingController,
    InstructorBankController,
    AdminInstructorController,
    AdminInstructorDecisionsController,
  ],
  providers: [
    InstructorService,
    InstructorDocumentService,
    AdminInstructorService,
    AdminInstructorReviewService,
    AdminInstructorManageService,
    InstructorProfileLookup,
    InstructorBankService,
    InstructorRepository,
    DocumentExpiryService,
  ],
  exports: [InstructorService],
})
export class InstructorModule {}
