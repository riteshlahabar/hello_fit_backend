import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/auth.decorators';
import { ErrorCode } from '../../common/errors/error-codes';
import { LocalDiskStorage } from './local-disk.storage';
import { isPublicKey } from './storage.port';

/**
 * Content type from the key's extension, which `extensionFor` put there.
 *
 * The row stores no mimetype, and `nosniff` means a wrong one is fatal rather
 * than merely untidy: `application/octet-stream` makes an `<img>` fail to
 * render instead of falling back to sniffing. Unknown stays octet-stream —
 * only these four types can be uploaded.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const contentTypeFor = (key: string): string => {
  const dot = key.lastIndexOf('.');
  const extension = dot === -1 ? '' : key.slice(dot).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
};

/**
 * Serves the objects that `LocalDiskStorage.signedUrl` points at.
 *
 * `@Public()` on purpose: the signature *is* the authorisation, exactly as it
 * is with S3 — the caller proves they were handed a live link by an endpoint
 * that did check their identity. Without it the Flutter app's image widget and
 * the admin panel's `<img>` could not load a KYC file, because neither attaches
 * a bearer token to a plain asset request.
 *
 * This route exists only in the local-disk development setup. Under S3 the
 * signed URL points at the bucket and nothing here is reachable.
 */
@Controller('files')
export class FileDownloadController {
  constructor(private readonly storage: LocalDiskStorage) {}

  @Public()
  @Get('*path')
  async download(
    @Param('path') path: string | string[],
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const key = Array.isArray(path) ? path.join('/') : path;

    // A profile photo is drawn on a public search card and cached by the
    // client; a 15-minute signature would break it. `public/` keys carry a
    // UUID and hold nothing but photos — see `PUBLIC_KEY_PREFIX`.
    if (!isPublicKey(key) &&
        !this.storage.verifySignature(key, Number(expires), sig ?? '')) {
      // One message for "expired", "tampered" and "never valid": a probing
      // caller should not learn which.
      throw new ForbiddenException({
        code: ErrorCode.FILE_LINK_INVALID,
        message: 'This link is invalid or has expired',
      });
    }

    let body: Buffer;
    try {
      body = await this.storage.read(key);
    } catch {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'File not found',
      });
    }

    res.setHeader('Content-Type', contentTypeFor(key));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Never inline: an uploaded SVG or HTML rendered in-origin would be XSS.
    // Browsers ignore this for an `<img>` subresource, which is how the photo
    // still renders, and honour it for a navigation, which is the risk.
    res.setHeader('Content-Disposition', 'attachment');

    if (isPublicKey(key)) {
      // A photo is immutable — a replacement gets a new UUID — so it can be
      // cached hard. This is the whole point of the public prefix.
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    } else {
      // No-store: a KYC document must not sit in a shared proxy cache after
      // the link expires.
      res.setHeader('Cache-Control', 'no-store, private');
    }

    res.send(body);
  }
}
