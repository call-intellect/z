import { Module } from '@nestjs/common';

import { CoreQueueModule } from '../../../core-queue/core-queue.module';
import { S3Service } from '../../../recordings/s3.service';

import { EmailFetchCron } from './email-fetch.cron';
import { EmailFetchService } from './email-fetch.service';

/**
 * IngestEmailModule (Фаза 10 knowledge-core).
 *
 * Содержит EmailFetchService + EmailFetchCron. Регистрируется в `AppModule`
 * отдельно от `IngestModule`, потому что cron включается только если
 * `EMAIL_FETCH_ENABLED=true` — на dev cron выходит сразу.
 *
 * Зависит от:
 *   - PrismaModule (@Global)
 *   - CryptoModule (@Global)
 *   - CoreQueueModule — экспортирует WorkerOrgGate.
 *   - IngestModule (@Global) — IngestService.
 *   - S3Service — отдельный провайдер тут (stateless; так же делает IngestModule).
 */
@Module({
  imports: [CoreQueueModule],
  providers: [EmailFetchService, EmailFetchCron, S3Service],
  exports: [EmailFetchService],
})
export class IngestEmailModule {}
