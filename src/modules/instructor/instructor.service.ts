import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InstructorRepository } from './instructor.repository';
import { setOfferingApproval } from './offering-approval';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_PORT, type StoragePort } from '../storage/storage.port';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate } from '../../common/dates/calendar';
import {
  allowedTransitions,
  canApprove,
  canSubmitForReview,
  canTransition,
  deriveKycStatus,
  expiredDocuments,
  missingDocuments,
  missingProfileFields,
  stageProgressPercent,
  unverifiedDocuments,
  type DocumentLike,
} from './onboarding';
import type {
  ApplyAsInstructorDto,
  UpdateInstructorProfileDto,
  UploadDocumentDto,
} from './dto/instructor.dto';
import type {
  AdminUpdateInstructorDto,
  ChangeInstructorStatusDto,
  ChangeOnboardingStageDto,
  ListInstructorsQueryDto,
  VerifyDocumentDto,
} from './dto/admin-instructor.dto';
import type { OnboardingStage } from '../../generated/prisma/enums';

/**
 * Minimal shape of a multer file. `@types/multer` is deliberately not installed
 * — multer itself already ships inside `@nestjs/platform-express`, and this is
 * the only place its type is needed.
 */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Context carried into the audit trail.
 *
 * `adminUserId` is the token subject on an admin route, which **is** the
 * `AdminUser.id` (`auth.adminLogin` signs `sub: admin.id`) — `AdminUser` has no
 * `userId` column at all, so there is nothing to look up. An earlier version of
 * this file tried to resolve one and would have thrown "Unknown argument
 * userId" on every admin action.
 */
export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Teacher onboarding, KYC documents and the verification pipeline (spec 3.6).
 *
 * This closes the Phase 1 gap that made the teacher side unusable: there was no
 * way to create an `InstructorProfile`, so `assignment`'s hard filter on
 * "active and KYC verified" was testing a flag nothing could ever set.
 *
 * Signup only ever grants `CUSTOMER` (`auth.verifyLoginOtp`), so applying is
 * what creates the profile and adds the `INSTRUCTOR` role — which is why
 * `apply` is reachable with a customer token and every other route here is not.
 */
@Injectable()
export class InstructorService {
  private readonly logger = new Logger(InstructorService.name);

  constructor(
    private readonly repo: InstructorRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly prisma: PrismaService,
  ) {}

  // =========================================================== teacher side

  /**
   * Starts an application. One per account: a second call is a conflict rather
   * than a second profile, because `InstructorProfile.userId` is unique and the
   * duplicate would surface as a raw Prisma error.
   */
  async apply(userId: string, dto: ApplyAsInstructorDto) {
    const existing = await this.repo.findProfileByUserId(userId);
    if (existing) {
      throw new ConflictException({
        code: ErrorCode.APPLICATION_EXISTS,
        message: 'An application already exists for this account',
      });
    }

    const profile = await this.repo.createApplication(userId, {
      name: dto.name,
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.experienceYears !== undefined && {
        experienceYears: dto.experienceYears,
      }),
      travelBufferMin: this.settings.get('scheduling').defaultTravelBufferMin,
    });

    this.logger.log(`Instructor application created profile=${profile.id}`);
    return this.decorate(profile, []);
  }

  /** The caller's own application, with the checklist the app renders. */
  async getOwnProfile(userId: string) {
    const profile = await this.requireOwnProfile(userId);
    const documents = await this.repo.listDocuments(profile.id);
    return this.decorate(profile, documents);
  }

  async updateOwnProfile(userId: string, dto: UpdateInstructorProfileDto) {
    const profile = await this.requireOwnProfile(userId);
    this.assertEditable(profile.onboardingStage);

    // Both halves of the home base or neither: a lone latitude would be scored
    // against longitude 0, which is in the Atlantic.
    const lat = dto.homeBaseLat ?? null;
    const lng = dto.homeBaseLng ?? null;
    if ((lat === null) !== (lng === null)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'homeBaseLat and homeBaseLng must be sent together',
      });
    }

    const updated = await this.repo.updateProfile(profile.id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.dob !== undefined && { dob: parseCalendarDate(dto.dob) }),
      ...(dto.bio !== undefined && { bio: dto.bio }),
      ...(dto.experienceYears !== undefined && {
        experienceYears: dto.experienceYears,
      }),
      ...(dto.languages !== undefined && { languages: { set: dto.languages } }),
      ...(dto.specialisations !== undefined && {
        specialisations: { set: dto.specialisations },
      }),
      ...(dto.homeBaseLat !== undefined && { homeBaseLat: dto.homeBaseLat }),
      ...(dto.homeBaseLng !== undefined && { homeBaseLng: dto.homeBaseLng }),
      ...(dto.travelRadiusKm !== undefined && {
        travelRadiusKm: dto.travelRadiusKm,
      }),
      ...(dto.sessionFormats !== undefined && {
        sessionFormats: dto.sessionFormats,
      }),
    });

    const documents = await this.repo.listDocuments(profile.id);
    return this.decorate(updated, documents);
  }

  /** One-time acceptance, required before an application can be submitted. */
  async acceptCodeOfConduct(userId: string) {
    const profile = await this.requireOwnProfile(userId);
    if (profile.codeOfConductAt) {
      return { acceptedAt: profile.codeOfConductAt };
    }
    const updated = await this.repo.updateProfile(profile.id, {
      codeOfConductAt: new Date(),
    });
    return { acceptedAt: updated.codeOfConductAt };
  }

  // -------------------------------------------------------------- documents

  async listOwnDocuments(userId: string) {
    const profile = await this.requireOwnProfile(userId);
    const documents = await this.repo.listDocuments(profile.id);
    // `fileUrl` is an object key in the private bucket. It never leaves the
    // server: the teacher gets a short-lived signed URL from a separate call.
    return documents.map(({ fileUrl: _fileUrl, ...rest }) => rest);
  }

  /**
   * Stores the file and replaces any previous document of the same type.
   *
   * Validation order matters: size and mime type are checked **before** the
   * bytes are written, so a rejected upload leaves nothing behind in the
   * bucket. The storage key carries the instructor id and a fresh UUID, never
   * the client's filename — an attacker-controlled name is a path-traversal
   * and overwrite risk.
   */
  async uploadOwnDocument(
    userId: string,
    dto: UploadDocumentDto,
    file: UploadedFileLike | undefined,
  ) {
    const profile = await this.requireOwnProfile(userId);
    const policy = this.settings.get('onboarding');

    if (!file) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A file is required',
      });
    }

    if (file.size > policy.maxFileSizeMb * 1024 * 1024) {
      throw new BadRequestException({
        code: ErrorCode.DOCUMENT_TOO_LARGE,
        message: `File must be ${policy.maxFileSizeMb} MB or smaller`,
      });
    }

    if (!policy.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException({
        code: ErrorCode.DOCUMENT_TYPE_NOT_ALLOWED,
        message: `Allowed file types: ${policy.allowedMimeTypes.join(', ')}`,
      });
    }

    const existing = await this.repo.listDocuments(profile.id);
    const current = existing.find((d) => d.docType === dto.docType);

    // A verified document is evidence; replacing it silently would let someone
    // swap a clean police verification for a different scan after approval.
    if (current?.verifyStatus === 'VERIFIED') {
      throw new ConflictException({
        code: ErrorCode.DOCUMENT_LOCKED,
        message:
          'This document is already verified. Ask support to replace it.',
      });
    }

    const key = `instructors/${profile.id}/${String(dto.docType).toLowerCase()}/${randomUUID()}${this.extensionFor(file.mimetype)}`;
    const stored = await this.storage.put({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    // The new upload is PENDING, so it counts as present for submission and as
    // unverified for approval.
    const nextDocuments: DocumentLike[] = [
      ...existing.filter((d) => d.docType !== dto.docType),
      { docType: dto.docType, verifyStatus: 'PENDING', expiryDate: dto.expiryDate ? parseCalendarDate(dto.expiryDate) : null },
    ];

    const document = await this.repo.replaceDocument({
      instructorId: profile.id,
      docType: dto.docType,
      kycStatus: deriveKycStatus(policy, nextDocuments),
      data: {
        docType: dto.docType,
        fileUrl: stored.key,
        verifyStatus: 'PENDING',
        ...(dto.number !== undefined && { number: dto.number }),
        ...(dto.issueDate !== undefined && {
          issueDate: parseCalendarDate(dto.issueDate),
        }),
        ...(dto.expiryDate !== undefined && {
          expiryDate: parseCalendarDate(dto.expiryDate),
        }),
      },
    });

    this.logger.log(
      `Document ${dto.docType} uploaded instructor=${profile.id} size=${stored.size}`,
    );

    const { fileUrl: _fileUrl, ...safe } = document;
    return safe;
  }

  /** A short-lived link to the teacher's own document. */
  async getOwnDocumentUrl(userId: string, documentId: string) {
    const profile = await this.requireOwnProfile(userId);
    const document = await this.repo.findDocument(profile.id, documentId);
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Document not found',
      });
    }
    return this.signedUrlFor(document.fileUrl);
  }

  /**
   * Removes an upload the teacher wants to redo. A verified document is not
   * theirs to delete — only support can, and the row is soft-deleted either
   * way so the file and its remarks survive a dispute.
   */
  async deleteOwnDocument(userId: string, documentId: string) {
    const profile = await this.requireOwnProfile(userId);
    const document = await this.repo.findDocument(profile.id, documentId);
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Document not found',
      });
    }

    if (document.verifyStatus === 'VERIFIED') {
      throw new ConflictException({
        code: ErrorCode.DOCUMENT_LOCKED,
        message: 'A verified document cannot be removed',
      });
    }

    const policy = this.settings.get('onboarding');
    const remaining = (await this.repo.listDocuments(profile.id)).filter(
      (d) => d.id !== documentId,
    );

    await this.repo.softDeleteDocument(
      documentId,
      deriveKycStatus(policy, remaining),
      profile.id,
    );
  }

  // ------------------------------------------------------------- submission

  /**
   * Submits the application for review. The gate is the pure calculator, so the
   * app can show the same checklist before the call and the reasons after it.
   */
  async submitForReview(userId: string) {
    const profile = await this.requireOwnProfile(userId);

    if (profile.onboardingStage !== 'APPLIED') {
      throw new ConflictException({
        code: ErrorCode.ONBOARDING_STAGE_LOCKED,
        message: 'This application has already been submitted',
      });
    }

    const policy = this.settings.get('onboarding');
    const documents = await this.repo.listDocuments(profile.id);
    const gate = canSubmitForReview(policy, profile, documents);

    if (!gate.ok) {
      throw new BadRequestException({
        code: ErrorCode.ONBOARDING_INCOMPLETE,
        message: 'Your application is not complete yet',
        details: gate.reasons,
      });
    }

    const updated = await this.repo.updateProfile(profile.id, {
      onboardingStage: 'DOCUMENTS_SUBMITTED',
      kycStatus: deriveKycStatus(policy, documents),
    });

    this.logger.log(`Application submitted instructor=${profile.id}`);
    return this.decorate(updated, documents);
  }

  // ============================================================= admin side

  async listForAdmin(query: ListInstructorsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { rows, total } = await this.repo.listProfiles({
      stage: query.stage,
      kycStatus: query.kycStatus,
      status: query.status,
      branchId: query.branchId,
      q: query.q,
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Full applicant file: profile, documents and why approval is or isn't open. */
  async getForAdmin(instructorId: string) {
    const profile = await this.requireProfile(instructorId);
    const documents = await this.repo.listDocuments(profile.id);
    const policy = this.settings.get('onboarding');

    return {
      ...this.decorate(profile, documents),
      // Admin sees the key, since the review screen asks for a signed URL per
      // document; the teacher-facing responses strip it.
      documents: documents.map(({ fileUrl: _fileUrl, ...rest }) => rest),
      approval: canApprove(policy, profile, documents),
      allowedStages: allowedTransitions(policy, profile.onboardingStage),
      upcomingSessions: await this.repo.countUpcomingSessions(profile.id),
      // PDF 6.5: "review provider service information" and "manage permitted
      // service visibility". Unapproved offerings are included — reviewing
      // them is the point of the screen.
      offerings: await this.repo.listOfferings(profile.id),
    };
  }

  async getDocumentUrlForAdmin(instructorId: string, documentId: string) {
    const document = await this.repo.findDocument(instructorId, documentId);
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Document not found',
      });
    }
    return this.signedUrlFor(document.fileUrl);
  }

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
    const profile = await this.requireProfile(instructorId);
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

    // Tell the teacher. A rejection they only discover by opening the app is
    // the single most common support ticket in a KYC flow, and the remark is
    // what makes the notification actionable.
    await this.notifications.emit(
      dto.verifyStatus === 'REJECTED' ? 'document.rejected' : 'document.verified',
      {
        instructor: { instructorId: profile.id },
        admin: true,
        data: {
          docType: String(updated.docType),
          remarks: dto.remarks ?? '',
        },
      },
    );

    const { fileUrl: _fileUrl, ...safe } = updated;
    return safe;
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
    const profile = await this.requireProfile(instructorId);
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
    return this.decorate(updated, documents);
  }

  /** Ops-owned scheduling fields. The teacher cannot set these themselves. */

  /**
   * Publish or unpublish one of a provider's service offerings (PDF 6.5).
   * This is what decides whether they appear on Find a Trainer at all.
   */
  async setOfferingApproval(
    instructorId: string,
    serviceId: string,
    approved: boolean,
    actor: AdminActor,
  ) {
    const profile = await this.requireProfile(instructorId);

    const { offering, updated } = await setOfferingApproval(
      this.prisma,
      profile.id,
      serviceId,
      approved,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: approved ? 'instructor.offering.approved' : 'instructor.offering.revoked',
      entityType: 'InstructorService',
      entityId: updated.id,
      before: { approvedAt: offering.approvedAt },
      after: { approvedAt: updated.approvedAt },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  async updateForAdmin(
    instructorId: string,
    dto: AdminUpdateInstructorDto,
    actor: AdminActor,
  ) {
    const profile = await this.requireProfile(instructorId);

    if (dto.branchId && !(await this.repo.branchExists(dto.branchId))) {
      throw new BadRequestException({
        code: ErrorCode.NOT_FOUND,
        message: 'Branch not found',
      });
    }

    const updated = await this.repo.updateProfile(profile.id, {
      ...(dto.branchId !== undefined && {
        branch: { connect: { id: dto.branchId } },
      }),
      ...(dto.dailySessionCap !== undefined && {
        dailySessionCap: dto.dailySessionCap,
      }),
      ...(dto.travelBufferMin !== undefined && {
        travelBufferMin: dto.travelBufferMin,
      }),
      ...(dto.travelRadiusKm !== undefined && {
        travelRadiusKm: dto.travelRadiusKm,
      }),
      // Ops sets this until `instructor_app` exists (§4.5). Without it the
      // PATCH validated the list, audited a change and saved nothing.
      ...(dto.sessionFormats !== undefined && {
        sessionFormats: dto.sessionFormats,
      }),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'instructor.updated',
      entityType: 'InstructorProfile',
      entityId: profile.id,
      before: {
        branchId: profile.branchId,
        dailySessionCap: profile.dailySessionCap,
        travelBufferMin: profile.travelBufferMin,
        travelRadiusKm: profile.travelRadiusKm,
        sessionFormats: profile.sessionFormats,
      },
      after: {
        branchId: updated.branchId,
        dailySessionCap: updated.dailySessionCap,
        travelBufferMin: updated.travelBufferMin,
        travelRadiusKm: updated.travelRadiusKm,
        sessionFormats: updated.sessionFormats,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  /**
   * Suspend, blacklist or reinstate. The response carries the count of sessions
   * still booked with this teacher: suspending someone mid-week leaves those
   * customers with nobody coming, and ops needs to see that number, so the
   * reassignment queue is worked rather than discovered on the day.
   */
  async changeStatus(
    instructorId: string,
    dto: ChangeInstructorStatusDto,
    actor: AdminActor,
  ) {
    const profile = await this.requireProfile(instructorId);

    const updated = await this.repo.updateProfile(profile.id, {
      status: dto.status,
      statusReason: dto.reason,
      // Off duty immediately, so the slot grid stops offering them before any
      // human gets to the reassignment queue.
      ...(dto.status !== 'ACTIVE' && { dutyStatus: 'OFF_DUTY' }),
    });

    const upcomingSessions = await this.repo.countUpcomingSessions(profile.id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'instructor.status_changed',
      entityType: 'InstructorProfile',
      entityId: profile.id,
      before: { status: profile.status, statusReason: profile.statusReason },
      after: { status: updated.status, statusReason: updated.statusReason },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    if (dto.status !== 'ACTIVE' && upcomingSessions > 0) {
      this.logger.warn(
        `Instructor ${profile.id} set ${dto.status} with ${upcomingSessions} upcoming session(s) needing reassignment`,
      );
    }

    return { ...updated, upcomingSessions };
  }

  // =============================================================== internals

  private async requireOwnProfile(userId: string) {
    const profile = await this.repo.findProfileByUserId(userId);
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_AN_APPLICANT,
        message: 'Apply as an instructor to continue',
      });
    }
    return profile;
  }

  private async requireProfile(instructorId: string) {
    const profile = await this.repo.findProfileById(instructorId);
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Instructor not found',
      });
    }
    return profile;
  }

  /**
   * The teacher may edit their own details right up to approval, and again
   * afterwards — but not while a reviewer is mid-decision on a rejected
   * application they have not reopened.
   */
  private assertEditable(stage: OnboardingStage): void {
    if (stage === 'REJECTED') {
      throw new ForbiddenException({
        code: ErrorCode.ONBOARDING_STAGE_LOCKED,
        message:
          'This application was rejected. Contact support to reopen it.',
      });
    }
  }

  /**
   * The onboarding view both the app and the admin panel render: where the
   * applicant is, what is still missing, and what is blocking approval.
   * Assembled from the pure calculator so the two surfaces cannot disagree.
   */
  private decorate(
    profile: {
      name: string;
      bio?: string | null;
      experienceYears: number;
      languages: string[];
      specialisations: string[];
      homeBaseLat?: unknown;
      homeBaseLng?: unknown;
      codeOfConductAt?: Date | null;
      onboardingStage: OnboardingStage;
    },
    documents: DocumentLike[],
  ) {
    const policy = this.settings.get('onboarding');
    const submission = canSubmitForReview(policy, profile, documents);

    return {
      ...profile,
      onboarding: {
        stage: profile.onboardingStage,
        progressPercent: stageProgressPercent(policy, profile.onboardingStage),
        requiredDocuments: policy.requiredDocuments,
        missingDocuments: missingDocuments(policy, documents),
        unverifiedDocuments: unverifiedDocuments(policy, documents),
        expiredDocuments: expiredDocuments(documents).map((d) =>
          String(d.docType),
        ),
        missingProfileFields: missingProfileFields(profile),
        codeOfConductAccepted: Boolean(profile.codeOfConductAt),
        canSubmit: submission.ok,
        blockedBy: submission.reasons,
      },
    };
  }

  private signedUrlFor(key: string) {
    const ttlMinutes = this.settings.get('onboarding').signedUrlTtlMinutes;
    return this.storage
      .signedUrl(key, ttlMinutes * 60)
      .then((url) => ({ url, expiresInSeconds: ttlMinutes * 60 }));
  }

  /** Maps an already-validated mime type to an extension for the storage key. */
  private extensionFor(mimetype: string): string {
    switch (mimetype) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'application/pdf':
        return '.pdf';
      default:
        return '';
    }
  }
}
