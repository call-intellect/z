import { Global, Module } from '@nestjs/common';

import { RecordingTrackReconcileCron } from './cron/recording-track-reconcile.cron';
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
 * `RecordingTrackReconcileCron` — периодическая сверка per-track дорожек
 * (ТЗ 2026-06-03 meeting-recording-reliability, Фаза 1).
 */
@Global()
@Module({
  controllers: [RecordingsController],
  providers: [
    RecordingsService,
    S3Service,
    LivekitEgressClient,
    RecordingTrackReconcileCron,
  ],
  exports: [RecordingsService, S3Service],
})
export class RecordingsModule {}
