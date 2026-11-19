import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InstructorRepository } from './instructor.repository';
import { InstructorProfileLookup } from './instructor-profile.lookup';
import { assertUploadable } from './document-upload.rules';
import { documentView } from './instructor-view';
import { extensionFor, signedUrlFor } from './instructor-files';
import { deriveKycStatus, type DocumentLike } from './onboarding';
import { isProfilePhoto, storageKeyFor } from './profile-photo';
import { SettingsService } from '../settings/settings.service';
import { STORAGE_PORT, type StoragePort } from '../storage/storage.port';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate } from '../../common/dates/calendar';
import type { UploadedFileLike } from './instructor-actor';
import type { UploadDocumentDto } from './dto/instructor-document.dto';

/**
 * The teacher's own KYC uploads (spec 3.6).
 *
 * Every route here resolves the profile from the token, so one teacher cannot
 * reach another's documents by guessing a UUID — the ownership check is in the
 * repository's query, never in a controller.
 *
 * `fileUrl` is an object key in the private bucket and never leaves the server:
 * responses go through `documentView`, and a reader gets a short-lived signed
 * URL from a separate call.
 */
@Injectable()
export class InstructorDocumentService {
  private readonly logger = new Logger(InstructorDocumentService.name);

  constructor(
    private readonly repo: InstructorRepository,
    private readonly lookup: InstructorProfileLookup,
    private readonly settings: SettingsService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async listOwnDocuments(userId: string) {
    const profile = await this.lookup.requireOwn(userId);
    const documents = await this.repo.listDocuments(profile.id);
    return documents.map(documentView);
  }

  /**
   * Stores the file and replaces any previous document of the same type.
   *
   * `assertUploadable` runs first and settles size, mime type and whether the
   * existing document is locked, so a rejected upload leaves nothing behind in
   * the bucket. The storage key carries the instructor id and a fresh UUID,
   * never the client's filename — an attacker-controlled name is a
   * path-traversal and overwrite risk.
   */
  async uploadOwnDocument(
    userId: string,
    dto: UploadDocumentDto,
    file: UploadedFileLike | undefined,
  ) {
    const profile = await this.lookup.requireOwn(userId);
    const policy = this.settings.get('onboarding');

    const existing = await this.repo.listDocuments(profile.id);
    const current = existing.find((d) => d.docType === dto.docType);
    assertUploadable(policy, dto.docType, file, current);

    const key = storageKeyFor(
      profile.id,
      dto.docType,
      extensionFor(file.mimetype),
    );
    const stored = await this.storage.put({
      key,
      body: file.buffer,
      contentType: file.mimetype,
    });

    const expiryDate = dto.expiryDate ? parseCalendarDate(dto.expiryDate) : null;

    // The new upload is PENDING, so it counts as present for submission and as
    // unverified for approval.
    const nextDocuments: DocumentLike[] = [
      ...existing.filter((d) => d.docType !== dto.docType),
      { docType: dto.docType, verifyStatus: 'PENDING', expiryDate },
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
        ...(dto.expiryDate !== undefined && { expiryDate }),
      },
    });

    // The photo is the one upload that also belongs on the profile: the search
    // card, favourites, reviews and bookings all read `photoUrl` and none of
    // them can see the document table.
    if (isProfilePhoto(dto.docType)) {
      await this.repo.updateProfile(profile.id, {
        photoUrl: this.storage.publicUrl(key),
      });
    }

    this.logger.log(
      `Document ${dto.docType} uploaded instructor=${profile.id} size=${stored.size}`,
    );

    return documentView(document);
  }

  /** A short-lived link to the teacher's own document. */
  async getOwnDocumentUrl(userId: string, documentId: string) {
    const profile = await this.lookup.requireOwn(userId);
    const document = await this.requireDocument(profile.id, documentId);
    return signedUrlFor(
      this.storage,
      this.settings.get('onboarding').signedUrlTtlMinutes,
      document.fileUrl,
    );
  }

  /**
   * Removes an upload the teacher wants to redo. A verified document is not
   * theirs to delete — only support can, and the row is soft-deleted either
   * way so the file and its remarks survive a dispute.
   */
  async deleteOwnDocument(userId: string, documentId: string) {
    const profile = await this.lookup.requireOwn(userId);
    const document = await this.requireDocument(profile.id, documentId);

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

    // Otherwise the card keeps showing a photo whose row is gone.
    if (isProfilePhoto(document.docType)) {
      await this.repo.updateProfile(profile.id, { photoUrl: null });
    }
  }

  private async requireDocument(instructorId: string, documentId: string) {
    const document = await this.repo.findDocument(instructorId, documentId);
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Document not found',
      });
    }
    return document;
  }
}
