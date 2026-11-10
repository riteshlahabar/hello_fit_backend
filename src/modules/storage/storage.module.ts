import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileDownloadController } from './file-download.controller';
import { LocalDiskStorage } from './local-disk.storage';
import { STORAGE_PORT } from './storage.port';
import { NodeEnv, type EnvVars } from '../../config/env.validation';

/**
 * Picks the file store. Only the local-disk stand-in exists today; the S3
 * implementation slots in here as a second provider and nothing outside this
 * folder changes.
 *
 * Production boots are refused rather than silently writing KYC documents to an
 * app server's disk, where a redeploy loses them and no backup covers them —
 * the same stance `PaymentModule` takes on a missing gateway key.
 */
const storageProvider = {
  provide: STORAGE_PORT,
  inject: [ConfigService, LocalDiskStorage],
  useFactory: (config: ConfigService<EnvVars, true>, local: LocalDiskStorage) => {
    const logger = new Logger('Storage');

    if (config.get('NODE_ENV', { infer: true }) === NodeEnv.Production) {
      throw new Error(
        'No production file store is configured. KYC documents require a ' +
          'private S3-compatible bucket; implement StoragePort for it and ' +
          'bind it here before deploying.',
      );
    }

    logger.warn(
      'Using local-disk storage — development only, files are not backed up',
    );
    return local;
  },
};

@Module({
  controllers: [FileDownloadController],
  providers: [LocalDiskStorage, storageProvider],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
