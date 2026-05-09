import { Global, Module } from '@nestjs/common';

import { LivekitEgressClient } from './livekit-egress.client';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { S3Service } from './s3.service';

/**
 * Глобальный Recordings-модуль.
 *
 * Экспортирует:
 *   - `RecordingsService` — нужен webhook-обработчику для FSM-переходов.
 *   - `S3Service` — нужен `RetentionService` (массовое удаление по ключам).
 *
 * `LivekitEgressClient` — внутренняя зависимость, не экспортируем.
 */
@Global()
@Module({
  controllers: [RecordingsController],
  providers: [RecordingsService, S3Service, LivekitEgressClient],
  exports: [RecordingsService, S3Service],
})
export class RecordingsModule {}
