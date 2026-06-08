import { Global, Module } from '@nestjs/common';

import { MeetingUploadsQueueService } from './meeting-uploads-queue.service';
import { MeetingUploadsController } from './meeting-uploads.controller';
import { MeetingUploadsService } from './meeting-uploads.service';

/**
 * Модуль ручной загрузки встреч (ТЗ-5 meeting-upload-diarization, Ф2).
 *
 * Транспорт загрузки (presigned PUT) + постановка обработки. Ingest-воркер
 * (`MeetingUploadIngestWorker`) регистрируется в `WorkersModule` (как
 * `FaststartWorker`) — он инжектит `MeetingUploadsQueueService` отсюда.
 *
 * `@Global`, чтобы `MeetingUploadsQueueService` был виден `WorkersModule`'у без
 * циклического импорта. Все остальные зависимости (Prisma / S3Service /
 * MeetingsService / RbacService / RedisService / TypedConfigService /
 * PipelineRunner / EntitlementGuard) приходят из @Global-модулей приложения.
 */
@Global()
@Module({
  controllers: [MeetingUploadsController],
  providers: [MeetingUploadsService, MeetingUploadsQueueService],
  exports: [MeetingUploadsService, MeetingUploadsQueueService],
})
export class MeetingUploadsModule {}
