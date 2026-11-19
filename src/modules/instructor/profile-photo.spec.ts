import { BadRequestException } from '@nestjs/common';
import {
  assertPhotoMimeType,
  isProfilePhoto,
  storageKeyFor,
} from './profile-photo';
import { PUBLIC_KEY_PREFIX } from '../storage/storage.port';
import type { DocumentType } from '../../generated/prisma/enums';

const PHOTO = 'PHOTO' as DocumentType;
const PAN = 'PAN' as DocumentType;

/**
 * The split between a public photo and a private KYC scan is a one-character
 * difference in a key, and getting it backwards either hides every provider's
 * photo (what happened before 19-11-2026) or serves a PAN card unsigned to
 * anyone who asks. Worth a unit test rather than only a smoke run.
 */
describe('profile photo storage', () => {
  it('puts a photo under the public prefix', () => {
    const key = storageKeyFor('inst-1', PHOTO, '.png');
    expect(key.startsWith(PUBLIC_KEY_PREFIX)).toBe(true);
    expect(key).toContain('instructors/inst-1/photo/');
    expect(key.endsWith('.png')).toBe(true);
  });

  it('leaves every other document private', () => {
    const key = storageKeyFor('inst-1', PAN, '.pdf');
    expect(key.startsWith(PUBLIC_KEY_PREFIX)).toBe(false);
    expect(key).toContain('instructors/inst-1/pan/');
  });

  it('gives each upload its own uuid, which is what makes it unguessable', () => {
    expect(storageKeyFor('inst-1', PHOTO, '.png')).not.toEqual(
      storageKeyFor('inst-1', PHOTO, '.png'),
    );
  });

  it('knows which docType is the photo', () => {
    expect(isProfilePhoto(PHOTO)).toBe(true);
    expect(isProfilePhoto(PAN)).toBe(false);
  });
});

describe('profile photo mime types', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(() => assertPhotoMimeType(PHOTO, type)).not.toThrow();
  });

  it('refuses a PDF as a photo, though it is a fine KYC scan', () => {
    expect(() => assertPhotoMimeType(PHOTO, 'application/pdf')).toThrow(
      BadRequestException,
    );
  });

  it('does not constrain any other document type', () => {
    expect(() => assertPhotoMimeType(PAN, 'application/pdf')).not.toThrow();
  });
});
