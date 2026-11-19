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

/**
 * The one key prefix served without a signature.
 *
 * A KYC document is private and expires; a provider's **profile photo** is the
 * opposite — it is drawn on a public search card for anonymous visitors, on a
 * review and inside a booking, and a 15-minute link would break the moment any
 * of those is cached. Those two things cannot share a rule, so they do not
 * share a prefix: anything under `public/` is world-readable by design and
 * everything else stays signed.
 *
 * Nothing but a profile photo may be written here. The guard is the key: it
 * carries a UUID, so a photo is unguessable even though it is unsigned.
 */
export const PUBLIC_KEY_PREFIX = 'public/';

/** True for keys the download route serves without checking a signature. */
export const isPublicKey = (key: string): boolean =>
  key.startsWith(PUBLIC_KEY_PREFIX);

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

  /**
   * A permanent, unsigned URL for an object under `PUBLIC_KEY_PREFIX`. Throws
   * for any other key, so a KYC document cannot be handed out by mistake.
   *
   * Synchronous on purpose: it is string-building, not a presign, and the
   * provider card that needs it is a pure mapper shared by five call sites.
   */
  publicUrl(key: string): string;

  /** True when the object exists. Used to spot an orphaned Document row. */
  exists(key: string): Promise<boolean>;

  /**
   * Permanently removes an object. Called only when a Document row is hard
   * deleted — a soft-deleted document keeps its file, because a rejected KYC
   * upload is evidence in a dispute.
   */
  remove(key: string): Promise<void>;
}
