import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { PersonsModule } from '../persons/persons.module';

import { BitrixAnalyzeCron } from './bitrix-analyze.cron';
import { BitrixApiClient } from './bitrix-api.client';
import { BitrixIngestService } from './bitrix-ingest.service';
import { BitrixInstallController } from './bitrix-install.controller';
import { BitrixIntegrationController } from './bitrix-integration.controller';
import { BitrixIntegrationService } from './bitrix-integration.service';
import { BitrixOAuthController } from './bitrix-oauth.controller';
import { BitrixSyncCron } from './bitrix-sync.cron';
import { BitrixSyncService } from './bitrix-sync.service';
import { BitrixAnalyzeQueueService } from './queue/bitrix-analyze.queue.service';
import { BitrixSyncQueueService } from './queue/bitrix-sync.queue.service';

@Module({
  imports: [PersonsModule, AccountsModule],
  controllers: [BitrixIntegrationController, BitrixOAuthController, BitrixInstallController],
  providers: [
    BitrixApiClient,
    BitrixIntegrationService,
    BitrixSyncService,
    BitrixSyncQueueService,
    BitrixSyncCron,
    BitrixIngestService,
    BitrixAnalyzeQueueService,
    BitrixAnalyzeCron,
  ],
  exports: [
    BitrixApiClient,
    BitrixIntegrationService,
    BitrixSyncService,
    BitrixSyncQueueService,
    BitrixIngestService,
    BitrixAnalyzeQueueService,
  ],
})
export class BitrixModule {}
