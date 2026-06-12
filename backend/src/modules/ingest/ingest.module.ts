import { Global, Module } from '@nestjs/common';

import { PersonsModule } from '../persons/persons.module';
import { S3Service } from '../recordings/s3.service';

import { MeetingIngestAdapter } from './adapters/meeting.adapter';
import { MangoCallWebhookController } from './adapters/phone-call/mango.controller';
import { MangoAdapterService } from './adapters/phone-call/mango.service';
import { ReportIngestListener } from './adapters/report-ingest.listener';
import { ReportIngestAdapter } from './adapters/report.adapter';
import { TelegramWebhookController } from './adapters/telegram/telegram.controller';
import { TelegramAdapterService } from './adapters/telegram/telegram.service';
import { TrackerAdapter } from './adapters/tracker/tracker.adapter';
import { WebFormDumpController } from './adapters/web-form/dump.controller';
import { DumpService } from './adapters/web-form/dump.service';
import { IngestTokenGuard } from './guards/ingest-token.guard';
import {
  IngestController,
  RawEventsController,
} from './ingest.controller';
import { IngestService } from './ingest.service';
import { MeetingReingestCron } from './meeting-reingest.cron';
import { DocumentParserService } from './parsers/document-parser.service';

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
  imports: [PersonsModule],
  controllers: [
    IngestController,
    RawEventsController,
    TelegramWebhookController,
    MangoCallWebhookController,
    WebFormDumpController,
  ],
  providers: [
    IngestService,
    MeetingIngestAdapter,
    // Фаза 2 «отчёт встречи → граф» (ТЗ 2026-06-11-report-to-graph-phase2.md):
    // вторичный путь — готовый fast-отчёт → RawEvent(meeting_report) → граф.
    // Listener ловит `meeting.report-fast-ready` (EventEmitter2 глобальный).
    ReportIngestAdapter,
    ReportIngestListener,
    TelegramAdapterService,
    MangoAdapterService,
    DumpService,
    IngestTokenGuard,
    S3Service,
    // Фаза 0b knowledge-core: парсер документов. Адаптеры (document.adapter /
    // text.adapter) — BullMQ-воркеры — регистрируются в WorkersModule.
    DocumentParserService,
    // Sprint 3 B1-3.1 — TrackerAdapter слушает `tracker.event_occurred`
    // (публикуется TrackerEmitterService из TrackerModule) и создаёт RawEvent.
    // Регистрация именно здесь, чтобы избежать циклической зависимости
    // IngestModule ↔ TrackerModule. EventEmitter2 — глобальный.
    TrackerAdapter,
    // Ф7 МТЗ «разблокировка конвейера» (баг #1/#8) — reingest-fallback.
    // @Cron каждые 15 мин: встречи с готовым транскриптом без RawEvent(meeting)
    // переигрываются через MeetingIngestAdapter.ingestMeeting (идемпотентно).
    MeetingReingestCron,
  ],
  exports: [
    IngestService,
    MeetingIngestAdapter,
    ReportIngestAdapter,
    TelegramAdapterService,
    MangoAdapterService,
    DumpService,
    DocumentParserService,
    TrackerAdapter,
  ],
})
export class IngestModule {}
