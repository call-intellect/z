import { Global, Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { MeetingIngestAdapter } from './adapters/meeting.adapter';
import { TelegramAdapterService } from './adapters/telegram/telegram.service';
import { IngestTokenGuard } from './guards/ingest-token.guard';
import {
  IngestController,
  RawEventsController,
} from './ingest.controller';
import { IngestService } from './ingest.service';

/**
 * IngestModule (Фаза 1 + Фаза 10 knowledge-core).
 *
 * Глобальный — `IngestService` и `MeetingIngestAdapter` нужны в нескольких
 * местах:
 *   - `analyze.worker` (WorkersModule) — после `ai_ready` дёргает
 *     `MeetingIngestAdapter.ingestMeeting(meetingId)`.
 *   - HTTP-эндпоинт `POST /api/v1/ingest` — для будущих внешних адаптеров.
 *
 * Фаза 10 — добавлены адаптеры `TelegramAdapterService` (используется и из
 * SourcesModule для регистрации webhook'ов) и др.
 *
 * `S3Service` — добавляем как provider, потому что RecordingsModule
 * экспортирует его, но мы не импортируем RecordingsModule (избегаем
 * циклов; S3Service — stateless, может быть инстанцирован отдельно).
 */
@Global()
@Module({
  controllers: [IngestController, RawEventsController],
  providers: [
    IngestService,
    MeetingIngestAdapter,
    TelegramAdapterService,
    IngestTokenGuard,
    S3Service,
  ],
  exports: [IngestService, MeetingIngestAdapter, TelegramAdapterService],
})
export class IngestModule {}
