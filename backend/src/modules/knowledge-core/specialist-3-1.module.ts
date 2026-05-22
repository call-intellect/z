import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist31CardHandler } from './services/specialist-3-1-card-handler.service';

/**
 * SBA α-7 — модуль регистрации специалиста 3.1 (Regulations) в
 * `CardSpecialistRegistry`.
 *
 * По образцу `Specialist34Module` (α-6): вынесен отдельно от
 * `KnowledgeCoreModule`, чтобы не создавать зависимость
 * KnowledgeCoreModule → ChatV2Module (концептуально KnowledgeCoreModule —
 * фундаментный слой, ChatV2Module — выше).
 *
 * Содержит только `Specialist31CardHandler`, который в `onModuleInit`
 * вызывает `cardSpecialistRegistry.register('3-1-regulations', this)`.
 *
 * Регистрируется в `AppModule` ПОСЛЕ `ChatV2Module` (где живёт
 * CardSpecialistRegistry).
 *
 * NB: сам Specialist31Service (LLM-extract → triage) живёт внутри
 * `KnowledgeCoreModule` (Global) и используется
 * `Specialist31RegulationsWorker` (WorkersModule).
 */
@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist31CardHandler],
  exports: [Specialist31CardHandler],
})
export class Specialist31Module {}
