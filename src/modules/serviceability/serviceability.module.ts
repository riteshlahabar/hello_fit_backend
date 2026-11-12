import { Module } from '@nestjs/common';
import { ServiceabilityController } from './serviceability.controller';
import { ServiceabilityService } from './serviceability.service';

/**
 * Exports the service so address writes can resolve an area without the
 * client knowing areas exist (`CustomerModule`).
 */
@Module({
  controllers: [ServiceabilityController],
  providers: [ServiceabilityService],
  exports: [ServiceabilityService],
})
export class ServiceabilityModule {}
