import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { PUBLIC_KEY_PREFIX } from '../storage/storage.port';
import type { DocumentType } from '../../generated/prisma/enums';

/**
 * Where a provider's profile photo lives, and why it is not like the rest.
 *
 * `PHOTO` arrives through the same upload route as a PAN scan, but the two are
 * opposites once stored. A KYC document is private, signed and short-lived. A
 * photo is drawn on the public search card (§5.5), on a review and inside a
 * booking, for visitors who are not logged in — so it goes under
 * `PUBLIC_KEY_PREFIX` and its permanent URL is copied onto
 * `InstructorProfile.photoUrl`, which is the column all four of those surfaces
 * already read.
 *
 * Until 19-11-2026 nothing ever wrote that column, so every provider card in
 * the platform showed no photo however many the provider uploaded.
 */

/** Image types a face can be. A PDF is a fine KYC scan and not a photo. */
const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const isProfilePhoto = (docType: DocumentType): boolean =>
  String(docType) === 'PHOTO';

/**
 * A photo is served unsigned, so it must not be something a browser could be
 * talked into treating as a document. Narrower than the policy's
 * `allowedMimeTypes`, which still governs every other type.
 */
export function assertPhotoMimeType(
  docType: DocumentType,
  mimetype: string,
): void {
  if (!isProfilePhoto(docType) || PHOTO_MIME_TYPES.includes(mimetype)) return;

  throw new BadRequestException({
    code: ErrorCode.DOCUMENT_TYPE_NOT_ALLOWED,
    message: `A profile photo must be one of: ${PHOTO_MIME_TYPES.join(', ')}`,
  });
}

/**
 * The storage key for one upload. The UUID is what makes an unsigned photo
 * unguessable, and it is new on every replacement — which is also why the
 * download route may cache a `public/` object hard.
 */
export function storageKeyFor(
  instructorId: string,
  docType: DocumentType,
  extension: string,
): string {
  const folder = String(docType).toLowerCase();
  const key = `instructors/${instructorId}/${folder}/${randomUUID()}${extension}`;
  return isProfilePhoto(docType) ? `${PUBLIC_KEY_PREFIX}${key}` : key;
}
