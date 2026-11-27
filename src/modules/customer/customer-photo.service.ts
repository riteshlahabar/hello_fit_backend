import { Inject, Injectable, Logger } from '@nestjs/common';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';
import {
  assertUploadablePhoto,
  photoKeyFor,
} from './customer-photo';
import { extensionFor } from '../instructor/instructor-files';
import {
  PUBLIC_KEY_PREFIX,
  STORAGE_PORT,
  type StoragePort,
} from '../storage/storage.port';

/** What the multipart interceptor hands over. Narrower than Express's type. */
export interface UploadedPhoto {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Upload and removal of the customer's own profile photo.
 *
 * Its own service rather than six more methods on `CustomerService`, which is
 * already 488 lines — the 200-line rule, and these two share a dependency
 * (`STORAGE_PORT`) that nothing else in the module needs.
 *
 * Ownership comes from the token in every case: `getProfile(userId)` resolves
 * the caller's own profile and no id is accepted from the path or the body, so
 * one customer cannot overwrite another's photo by guessing a UUID.
 */
@Injectable()
export class CustomerPhotoService {
  private readonly logger = new Logger(CustomerPhotoService.name);

  constructor(
    private readonly customers: CustomerService,
    private readonly repo: CustomerRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /**
   * Replaces the photo and returns the fresh profile.
   *
   * Order matters: validate, then write the object, then point the column at
   * it. A failed upload therefore leaves the old photo intact rather than a
   * profile referring to bytes that were never stored.
   */
  async replacePhoto(userId: string, file: UploadedPhoto | undefined) {
    assertUploadablePhoto(file);
    const photo = file as UploadedPhoto;

    const profile = await this.customers.getProfile(userId);
    const previousUrl = profile.photoUrl;

    const stored = await this.storage.put({
      key: photoKeyFor(profile.id, extensionFor(photo.mimetype)),
      body: photo.buffer,
      contentType: photo.mimetype,
    });

    await this.repo.updateProfile(profile.id, {
      photoUrl: this.storage.publicUrl(stored.key),
    });

    await this.discard(previousUrl);
    return this.customers.getProfile(userId);
  }

  /** Clears the column and deletes the object. Initials come back. */
  async removePhoto(userId: string) {
    const profile = await this.customers.getProfile(userId);

    if (profile.photoUrl) {
      await this.repo.updateProfile(profile.id, { photoUrl: null });
      await this.discard(profile.photoUrl);
    }

    return this.customers.getProfile(userId);
  }

  /**
   * Deletes a superseded object, and never fails the request for it.
   *
   * The column is the truth the customer sees; an object left behind is wasted
   * disk and nothing more, so a storage error here is logged rather than
   * thrown — the photo they just uploaded is already saved and reporting a
   * failure would be a lie.
   */
  private async discard(url: string | null): Promise<void> {
    if (!url) return;

    const key = this.keyFromPublicUrl(url);
    if (!key) return;

    try {
      await this.storage.remove(key);
    } catch (error) {
      this.logger.warn(
        `Could not delete the superseded photo ${key}: ${String(error)}`,
      );
    }
  }

  /**
   * The key inside a permanent public URL — `publicUrl` run backwards.
   *
   * The prefix is derived by asking the port what it would produce for
   * `PUBLIC_KEY_PREFIX` itself, so this keeps working when the local-disk
   * stand-in is swapped for S3 and the host changes. It is asked for that key
   * and not the empty one because `publicUrl` refuses to build an unsigned URL
   * for anything outside the public prefix.
   *
   * A URL that does not carry that prefix was written by an older shape, or by
   * a different store, and is left alone rather than guessed at.
   */
  private keyFromPublicUrl(url: string): string | null {
    const base = this.storage.publicUrl(PUBLIC_KEY_PREFIX);
    if (!url.startsWith(base)) return null;

    // `publicUrl` runs the key through `encodeURI`.
    return `${PUBLIC_KEY_PREFIX}${decodeURI(url.slice(base.length))}`;
  }
}
