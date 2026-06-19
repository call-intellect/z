import { Module } from '@nestjs/common';

import { IntegrationSyncLogPruneCron } from './integration-sync-log-prune.cron';
import { IntegrationSyncLogService } from './integration-sync-log.service';

@Module({
  providers: [IntegrationSyncLogService, IntegrationSyncLogPruneCron],
  exports: [IntegrationSyncLogService],
})
export class IntegrationObservabilityModule {}
