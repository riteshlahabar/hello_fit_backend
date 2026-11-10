/**
 * The port every file store implements. KYC documents must sit in a **private**
 * bucket and only ever be reachable through a time-limited signed URL (spec
 * 10.1), so nothing outside this folder may know whether the bytes are on local
 * disk, S3 or anywhere else — and no domain code may build a public URL.
 *
 * Same shape as `PAYMENT_GATEWAY`: an interface, a dev stand-in, and a factory
 * in the module that refuses to boot into the stand-in in production.
 */
export const STORAGE_PORT = Symbol('STORAGE_PORT');

export interface StoredObject {
  /**
   * The object key, e.g. `instructors/<uuid>/pan/<uuid>.pdf`. This is what goes
   * in `Document.fileUrl` — a key, never a URL, so the bucket can move.
   */
  key: string;
  size: number;
  contentType: string;
  /** SHA-256 of the bytes, so a re-upload of the same file is detectable. */
  checksum: string;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoragePort {
  readonly name: string;

  /** Writes (or overwrites) an object. */
  put(input: PutObjectInput): Promise<StoredObject>;

  /**
   * A URL that grants read access to one object for `ttlSeconds` and no longer.
   * Never return a permanent link: a leaked KYC URL must expire on its own.
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;

  /** True when the object exists. Used to spot an orphaned Document row. */
  exists(key: string): Promise<boolean>;

  /**
   * Permanently removes an object. Called only when a Document row is hard
   * deleted — a soft-deleted document keeps its file, because a rejected KYC
   * upload is evidence in a dispute.
   */
  remove(key: string): Promise<void>;
}
