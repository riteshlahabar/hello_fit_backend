import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InstructorRepository } from './instructor.repository';
import { InstructorProfileLookup } from './instructor-profile.lookup';
import { decorateProfile, documentView } from './instructor-view';
import {
  allowedTransitions,
  canApprove,
  canTransition,
  deriveKycStatus,
} from './onboarding';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AdminActor } from './instructor-actor';
import type {
  ChangeOnboardingStageDto,
  VerifyDocumentDto,
} from './dto/admin-instructor.dto';

/**
 * The two reviewer decisions: verifying a document and moving a stage.
 *
 * Both are audited with before/after and both notify the teacher — a rejection
 * they only discover by opening the app is the single most common support
 * ticket in a KYC flow. Separated from the read side so the audit trail and
 * the notifier are injected only where a decision is actually made.
 */
@Injectable()
export class AdminInstructorReviewService {
  private readonly logger = new Logger(AdminInstructorReviewService.name);

  constructor(
    private readonly repo: InstructorRepository,
    private readonly lookup: InstructorProfileLookup,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Verify or reject one document. A rejection must carry a remark — the
   * teacher is told what to fix — and the profile's `kycStatus` is recomputed
   * from the resulting set rather than inferred from this one decision.
   */
  async verifyDocument(
    instructorId: string,
    documentId: string,
    dto: VerifyDocumentDto,
    actor: AdminActor,
  ) {
    const profile = await this.lookup.requireById(instructorId);
    const document = await this.repo.findDocument(profile.id, documentId);
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Document not found',
      });
    }

    if (dto.verifyStatus === 'REJECTED' && !dto.remarks) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A remark is required when rejecting a document',
      });
    }

    const policy = this.settings.get('onboarding');
    const documents = await this.repo.listDocuments(profile.id);
    const next = documents.map((d) =>
      d.id === documentId ? { ...d, verifyStatus: dto.verifyStatus } : d,
    );

    const adminUserId = actor.adminUserId;
    const updated = await this.repo.verifyDocument({
      documentId,
      instructorId: profile.id,
      verifyStatus: dto.verifyStatus,
      verifiedById: adminUserId,
      remarks: dto.remarks,
      kycStatus: deriveKycStatus(policy, next),
    });

    await this.audit.record({
      adminUserId,
      action: 'instructor.document_verified',
      entityType: 'Document',
      entityId: documentId,
      before: {
        verifyStatus: document.verifyStatus,
        remarks: document.remarks,
      },
      after: { verifyStatus: updated.verifyStatus, remarks: updated.remarks },
      reason: dto.remarks,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    // The remark is what makes the notification actionable.
    await this.notifications.emit(
      dto.verifyStatus === 'REJECTED'
        ? 'document.rejected'
        : 'document.verified',
      {
        instructor: { instructorId: profile.id },
        admin: true,
        data: {
          docType: String(updated.docType),
          remarks: dto.remarks ?? '',
        },
      },
    );

    return documentView(updated);
  }

  /**
   * Moves an applicant through the pipeline. Two checks, both refusable:
   * the transition must be legal for the configured pipeline, and `APPROVED`
   * additionally requires every must-verify document actually verified —
   * approval is what lets us send someone into a stranger's home, so it is not
   * a button ops can click past.
   */
  async changeStage(
    instructorId: string,
    dto: ChangeOnboardingStageDto,
    actor: AdminActor,
  ) {
    const profile = await this.lookup.requireById(instructorId);
    const policy = this.settings.get('onboarding');

    if (!canTransition(policy, profile.onboardingStage, dto.stage)) {
      throw new BadRequestException({
        code: ErrorCode.STAGE_TRANSITION_INVALID,
        message: `Cannot move from ${profile.onboardingStage} to ${dto.stage}`,
        details: allowedTransitions(policy, profile.onboardingStage),
      });
    }

    const documents = await this.repo.listDocuments(profile.id);

    if (dto.stage === 'APPROVED') {
      const gate = canApprove(policy, profile, documents);
      if (!gate.ok) {
        throw new BadRequestException({
          code: ErrorCode.ONBOARDING_INCOMPLETE,
          message: 'This applicant cannot be approved yet',
          details: gate.reasons,
        });
      }
    }

    const updated = await this.repo.updateProfile(profile.id, {
      onboardingStage: dto.stage,
      kycStatus: deriveKycStatus(policy, documents),
      // `joinedAt` is the teacher's start date, stamped once on first approval
      // so a later re-approval does not reset their seniority.
      ...(dto.stage === 'APPROVED' &&
        !profile.joinedAt && { joinedAt: new Date() }),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'instructor.stage_changed',
      entityType: 'InstructorProfile',
      entityId: profile.id,
      before: { onboardingStage: profile.onboardingStage },
      after: { onboardingStage: updated.onboardingStage },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    await this.notifications.emit('onboarding.stage_changed', {
      instructor: { instructorId: profile.id },
      admin: true,
      data: { stage: dto.stage, reason: dto.reason },
    });

    this.logger.log(
      `Stage ${profile.onboardingStage} -> ${dto.stage} instructor=${profile.id}`,
    );
    return decorateProfile(policy, updated, documents);
  }
}
