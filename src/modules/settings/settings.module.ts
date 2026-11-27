import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SupportController } from './support.controller';

/// Global because pricing, slot search, matching and refunds all read policy
/// on nearly every request, and there is one cached copy per process.
///
/// It also carries the one route that serves a policy group straight out:
/// `GET /support/contact` (§3.11), which is the support contact block and
/// nothing more.
@Global()
@Module({
  controllers: [SupportController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
