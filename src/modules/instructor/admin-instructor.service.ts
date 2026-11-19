import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InstructorRepository } from './instructor.repository';
import { InstructorProfileLookup } from './instructor-profile.lookup';
import { decorateProfile, documentView } from './instructor-view';
import { signedUrlFor } from './instructor-files';
import { canApprove, allowedTransitions } from './onboarding';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_PORT, type StoragePort } from '../storage/storage.port';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ListInstructorsQueryDto } from './dto/admin-instructor.dto';

/**
 * The read side of teacher recruitment (spec 5.2): the applicant pipeline and
 * one applicant's full file.
 *
 * Decisions live next door — `AdminInstructorReviewService` verifies documents
 * and moves stages, `AdminInstructorManageService` edits and suspends. Split
 * that way because only the decision paths need the audit trail and the
 * notifier, and this one needs neither.
 */
@Injectable()
export class AdminInstructorService {
  constructor(
    private readonly repo: InstructorRepository,
    private readonly lookup: InstructorProfileLookup,
    private readonly settings: SettingsService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

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
    const profile = await this.lookup.requireById(instructorId);
    const documents = await this.repo.listDocuments(profile.id);
    const policy = this.settings.get('onboarding');

    return {
      ...decorateProfile(policy, profile, documents),
      // The review screen lists every document and asks for a signed URL per
      // row; `documentView` drops the private storage key.
      documents: documents.map(documentView),
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
    return signedUrlFor(
      this.storage,
      this.settings.get('onboarding').signedUrlTtlMinutes,
      document.fileUrl,
    );
  }
}
