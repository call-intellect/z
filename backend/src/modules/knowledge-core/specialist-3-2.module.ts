import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist32CardHandler } from './services/specialist-3-2-card-handler.service';

/**
 * SBA β-2 — модуль регистрации специалиста 3.2 (Knowledge Clone) в
 * `CardSpecialistRegistry`.
 *
 * По образцу `Specialist31Module` / `Specialist34Module`: вынесен отдельно
 * от `KnowledgeCoreModule`, чтобы не создавать зависимость
 * KnowledgeCoreModule → ChatV2Module (концептуально KnowledgeCoreModule —
 * фундаментный слой, ChatV2Module — выше).
 *
 * Содержит только `Specialist32CardHandler`, который в `onModuleInit`
 * вызывает `cardSpecialistRegistry.register('3-2-knowledge-clone', this)`.
 *
 * Регистрируется в `AppModule` ПОСЛЕ `ChatV2Module` (где живёт
 * CardSpecialistRegistry).
 *
 * NB: сам Specialist32Service (LLM-extract → merge → triage) живёт внутри
 * `KnowledgeCoreModule` (Global) и используется
 * `KnowledgeCloneRebuildWorker` (WorkersModule).
 */
@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist32CardHandler],
  exports: [Specialist32CardHandler],
})
export class Specialist32Module {}
