import type { StoragePort } from '../storage/storage.port';

/**
 * The two file chores shared by the teacher-side and admin-side document
 * routes: minting a signed URL and naming the object.
 *
 * Pure functions taking the port, rather than a third injectable — there is no
 * state here, and both callers already hold the port and the policy.
 */

/**
 * A short-lived link to a private object, with the TTL the caller must honour.
 * The admin review screen and the teacher's own document list both return
 * this exact shape.
 */
export async function signedUrlFor(
  storage: StoragePort,
  ttlMinutes: number,
  key: string,
) {
  const expiresInSeconds = ttlMinutes * 60;
  const url = await storage.signedUrl(key, expiresInSeconds);
  return { url, expiresInSeconds };
}

/**
 * Maps an already-validated mime type to an extension for the storage key.
 *
 * Returns '' for anything unlisted rather than guessing: the mime type has
 * passed the policy's allow-list by the time this is called, so an empty
 * extension means the allow-list grew and this switch did not.
 */
export function extensionFor(mimetype: string): string {
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

/**
 * Whether a stored object can be shown inline as an image, from the extension
 * on its key — the mirror of `extensionFor`, and the only thing the admin
 * review page needs to decide between a thumbnail and a file tile.
 *
 * Read from the key rather than a column: there is no mime type on
 * `documents`, and the key is written by `extensionFor` above, so the two
 * cannot drift.
 */
export function fileKindFor(key: string | undefined): 'IMAGE' | 'PDF' | 'OTHER' {
  const extension = (key ?? '').split('?')[0].split('.').pop()?.toLowerCase();

  if (extension === 'jpg' || extension === 'jpeg') return 'IMAGE';
  if (extension === 'png' || extension === 'webp') return 'IMAGE';
  if (extension === 'pdf') return 'PDF';
  return 'OTHER';
}
