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

    if (!this.storage.verifySignature(key, Number(expires), sig ?? '')) {
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

    // No-store: a KYC document must not sit in a shared proxy cache after the
    // link expires.
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Never inline: an uploaded SVG or HTML rendered in-origin would be XSS.
    res.setHeader('Content-Disposition', 'attachment');
    res.send(body);
  }
}
