import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env.validation';
import type {
  PutObjectInput,
  StoragePort,
  StoredObject,
} from './storage.port';

/**
 * Development stand-in for the private bucket: writes under `STORAGE_ROOT` and
 * signs URLs with HMAC-SHA256 so the expiry and the tamper check behave exactly
 * like S3's. Swapping in S3 later changes one provider binding and nothing
 * else — the signed-URL contract is identical.
 *
 * Deliberately not usable in production: `StorageModule` refuses to boot into
 * this when `NODE_ENV=production`, because KYC files on an app server's disk
 * are lost on redeploy and backed up by nothing.
 */
@Injectable()
export class LocalDiskStorage implements StoragePort {
  readonly name = 'local-disk';

  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly root: string;
  private readonly secret: string;

  constructor(private readonly config: ConfigService<EnvVars, true>) {
    this.root = resolve(
      this.config.get('STORAGE_ROOT', { infer: true }) ?? 'storage',
    );
    // Reuses the refresh secret so development needs no extra variable; S3
    // will use its own credentials and never touch this.
    this.secret = this.config.get('JWT_REFRESH_SECRET', { infer: true });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const path = this.resolveKey(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);

    this.logger.debug(`Stored ${input.key} (${input.body.byteLength} bytes)`);

    return {
      key: input.key,
      size: input.body.byteLength,
      contentType: input.contentType,
      checksum: createHash('sha256').update(input.body).digest('hex'),
    };
  }

  /**
   * `/api/v1/files/<key>?expires=<unix>&sig=<hmac>`. The signature covers the
   * key *and* the expiry, so neither can be edited independently.
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, expires);
    const base = this.config.get('PUBLIC_BASE_URL', { infer: true }) ?? '';
    const query = `expires=${expires}&sig=${sig}`;
    return Promise.resolve(
      `${base}/api/v1/files/${encodeURI(key)}?${query}`,
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.resolveKey(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  // ------------------------------------------------- signed-URL verification

  /**
   * Validates a signature produced by `signedUrl`. Constant-time, and the
   * expiry is checked before the comparison so an expired link cannot be used
   * as a signing oracle.
   */
  verifySignature(key: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;

    const expected = Buffer.from(this.sign(key, expires), 'hex');
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    if (expected.byteLength !== given.byteLength) return false;
    return timingSafeEqual(expected, given);
  }

  /** Reads the bytes back for the signed-download route. */
  read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${key}:${expires}`)
      .digest('hex');
  }

  /**
   * Keys come from our own code, but a path-traversal guard here is cheap and
   * this is the one place that turns a string into a filesystem path.
   */
  private resolveKey(key: string): string {
    const path = resolve(join(this.root, normalize(key)));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`Refusing to resolve key outside storage root: ${key}`);
    }
    return path;
  }
}
