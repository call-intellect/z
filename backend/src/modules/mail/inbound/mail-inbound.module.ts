import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../common/prisma/prisma.module';
import { RecordingsModule } from '../../recordings/recordings.module';
import { TrackerModule } from '../../tracker/tracker.module';

import { ImapPollCron } from './imap-poll.cron';
import { ProjectEmailInboxController } from './project-email-inbox.controller';
import { ProjectEmailInboxService } from './project-email-inbox.service';
import { ProjectInboxService } from './project-inbox.service';

/**
 * MailInboundModule (Tracker Phase 4, T5 — Email-to-task).
 *
 * Два независимых потока:
 *  1. IMAP-поллинг (`ImapPollCron` → `ProjectInboxService.pollInbox()`) →
 *     routing по alias → `IssuesService.create()` + `S3Service.putObject()`.
 *  2. REST-управление per-project alias'ом (`ProjectEmailInboxController` →
 *     `ProjectEmailInboxService`).
 *
 * Зависимости:
 *  - `PrismaModule` — Project + MailInboundLog + IssueAttachment.
 *  - `TrackerModule` — экспортирует `IssuesService` (используется ProjectInboxService).
 *  - `RecordingsModule` — экспортирует `S3Service` (для вложений).
 *  - `RbacModule` (@Global) — `RbacService` в контроллере.
 *  - `MetricsModule` (@Global) — `BusinessMetricsService`.
 *  - `ConfigModule` (@Global) — `TypedConfigService`.
 *
 * NB: модуль НЕ @Global — наружу ничего не экспортируем. REST доступен
 * только через HTTP.
 */
@Module({
  imports: [PrismaModule, TrackerModule, RecordingsModule],
  controllers: [ProjectEmailInboxController],
  providers: [ProjectInboxService, ProjectEmailInboxService, ImapPollCron],
})
export class MailInboundModule {}
