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
import { IngestController, RawEventsController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { MeetingReingestCron } from './meeting-reingest.cron';
import { DocumentParserService } from './parsers/document-parser.service';

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
    ReportIngestAdapter,
    ReportIngestListener,
    TelegramAdapterService,
    MangoAdapterService,
    DumpService,
    IngestTokenGuard,
    S3Service,
    DocumentParserService,
    TrackerAdapter,
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
