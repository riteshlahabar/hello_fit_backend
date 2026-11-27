import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { PUBLIC_KEY_PREFIX } from '../storage/storage.port';

/**
 * Where a customer's profile photo lives, and the rules it has to pass.
 *
 * Deliberately a sibling of `instructor/profile-photo.ts` rather than a shared
 * helper: the two answer different questions. A provider's photo arrives
 * through the KYC upload route and has to be told apart from a PAN scan; a
 * customer has no KYC at all, so there is one route, one type and nothing to
 * branch on. Sharing them would mean passing a `DocumentType` a customer does
 * not have.
 *
 * What the two DO share is the storage rule, and that is the part that matters:
 * a photo is drawn in an `<img>` on the customer's own profile and beside their
 * name, so it goes under `PUBLIC_KEY_PREFIX` and is served unsigned. A
 * short-lived signed link would break the moment the page is cached.
 *
 * Client instruction, 27-11-2026. PDF §5.9 lists "view profile details" and
 * "manage addresses" and names no photo, so this exists on the client's word.
 */

/** Three image types a face can be. A PDF is not a photo. */
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Smaller than the 25 MB a KYC scan is allowed. A profile photo is displayed
 * at roughly 96 px; anything past a few megabytes is a camera original that
 * costs the customer their data and us the disk.
 */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Settles mime type and size before a single byte is written, so a rejected
 * upload leaves nothing orphaned in the bucket.
 *
 * `file` is typed as possibly missing because that is what the interceptor
 * hands over when the multipart part is named anything but `file` — the most
 * common way this route is called wrongly, and a 400 is the useful answer.
 */
export function assertUploadablePhoto(
  file: { mimetype: string; size: number } | undefined,
): void {
  if (!file) {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Attach the image as the `file` field of a multipart request',
    });
  }

  if (!PHOTO_MIME_TYPES.includes(file.mimetype)) {
    throw new BadRequestException({
      code: ErrorCode.DOCUMENT_TYPE_NOT_ALLOWED,
      message: `A profile photo must be one of: ${PHOTO_MIME_TYPES.join(', ')}`,
    });
  }

  // The interceptor's own `limits.fileSize` truncates silently rather than
  // throwing, so the size is checked here too and the customer is told why.
  if (file.size > PHOTO_MAX_BYTES) {
    throw new BadRequestException({
      code: ErrorCode.DOCUMENT_TOO_LARGE,
      message: `A profile photo must be ${PHOTO_MAX_BYTES / (1024 * 1024)} MB or smaller`,
    });
  }
}

/**
 * The storage key for one photo.
 *
 * A fresh UUID every time, never the client's filename: an
 * attacker-controlled name is a path-traversal and overwrite risk, and the
 * UUID is also what makes an unsigned object unguessable. New on every
 * replacement, which is why the download route may cache a `public/` object
 * hard — the URL changes when the photo does.
 */
export function photoKeyFor(customerId: string, extension: string): string {
  return `${PUBLIC_KEY_PREFIX}customers/${customerId}/photo/${randomUUID()}${extension}`;
}
