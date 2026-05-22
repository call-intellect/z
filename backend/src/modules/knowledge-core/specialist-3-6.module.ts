import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { IdeasClosingLoopHandler } from './services/ideas-closing-loop.handler';
import { Specialist36CardHandler } from './services/specialist-3-6-card-handler.service';

/**
 * SBA β-5 — модуль регистрации специалиста 3.6 (Ideas Collector) в
 * `CardSpecialistRegistry`. По образцу Specialist35Module / Specialist31Module.
 *
 * Содержит `Specialist36CardHandler` (регистрируется в `onModuleInit`) и
 * `IdeasClosingLoopHandler` (слушает `idea.status_changed` через @OnEvent).
 *
 * Сам `Specialist36Service`, `Specialist36ProbeService` живут в
 * `KnowledgeCoreModule` (@Global). Воркер `Specialist36IdeasWorker` и cron
 * `IdeaClustererCron` — в `WorkersModule`.
 *
 * Регистрируется в AppModule ПОСЛЕ ChatV2Module и ProbeModule.
 */
@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist36CardHandler, IdeasClosingLoopHandler],
  exports: [Specialist36CardHandler],
})
export class Specialist36Module {}
