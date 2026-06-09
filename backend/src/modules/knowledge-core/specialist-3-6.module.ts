import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { IdeaStatusAutoAdvanceService } from './services/idea-status-auto-advance.service';
import { IdeasClosingLoopHandler } from './services/ideas-closing-loop.handler';
import { Specialist36CardHandler } from './services/specialist-3-6-card-handler.service';

/**
 * SBA β-5 — модуль регистрации специалиста 3.6 (Ideas Collector) в
 * `CardSpecialistRegistry`. По образцу Specialist35Module / Specialist31Module.
 *
 * Содержит `Specialist36CardHandler` (регистрируется в `onModuleInit`),
 * `IdeasClosingLoopHandler` (слушает `idea.status_changed` через @OnEvent) и
 * `IdeaStatusAutoAdvanceService` (TZ-1 Ф4.A — слушает `tracker.event_occurred`
 * и авто-продвигает статус идеи при закрытии связанной задачи).
 *
 * Сам `Specialist36Service`, `Specialist36ProbeService` живут в
 * `KnowledgeCoreModule` (@Global). Воркер `Specialist36IdeasWorker` и cron
 * `IdeaClustererCron` — в `WorkersModule`.
 *
 * Регистрируется в AppModule ПОСЛЕ ChatV2Module и ProbeModule.
 */
@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [
    Specialist36CardHandler,
    IdeasClosingLoopHandler,
    IdeaStatusAutoAdvanceService,
  ],
  exports: [Specialist36CardHandler],
})
export class Specialist36Module {}
