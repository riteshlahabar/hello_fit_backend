import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertPhotoMimeType } from './profile-photo';
import { ErrorCode } from '../../common/errors/error-codes';
import type { UploadedFileLike } from './instructor-actor';
import type { OnboardingPolicy } from '../settings/settings.defaults';
import type { VerifyStatus } from '../../generated/prisma/enums';
import type { DocumentType } from '../../generated/prisma/enums';

/**
 * Everything that can refuse an upload, in the order it must be checked.
 *
 * Order matters: size and mime type are settled **before** the bytes are
 * written, so a rejected upload leaves nothing behind in the bucket. Split out
 * of `instructor.service.ts` so the write path reads as four lines of storage
 * work rather than thirty of guard clauses.
 */
export function assertUploadable(
  policy: OnboardingPolicy,
  docType: DocumentType,
  file: UploadedFileLike | undefined,
  current: { verifyStatus: VerifyStatus } | undefined,
): asserts file is UploadedFileLike {
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

  // Narrower than the policy: a PDF is a fine certificate and a useless
  // profile photo, and the search card cannot render one.
  assertPhotoMimeType(docType, file.mimetype);

  // A verified document is evidence; replacing it silently would let someone
  // swap a clean police verification for a different scan after approval.
  if (current?.verifyStatus === 'VERIFIED') {
    throw new ConflictException({
      code: ErrorCode.DOCUMENT_LOCKED,
      message: 'This document is already verified. Ask support to replace it.',
    });
  }
}
