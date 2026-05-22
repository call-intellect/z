import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist33CardHandler } from './services/specialist-3-3-card-handler.service';

/**
 * SBA β-3 — модуль регистрации специалиста 3.3 (Decisions) в
 * `CardSpecialistRegistry`.
 *
 * По образцу `Specialist31Module` (α-7) / `Specialist34Module` (α-6):
 * вынесен отдельно от `KnowledgeCoreModule`, чтобы не создавать зависимость
 * KnowledgeCoreModule → ChatV2Module.
 *
 * Содержит только `Specialist33CardHandler`, который в `onModuleInit`
 * вызывает `cardSpecialistRegistry.register('3-3-decisions', this)`.
 *
 * Регистрируется в `AppModule` ПОСЛЕ `ChatV2Module` (где живёт
 * `CardSpecialistRegistry`).
 *
 * NB: сам `Specialist33Service` (LLM-extract → KNN → triage), а также
 * `Specialist33ProbeService` живут внутри `KnowledgeCoreModule` (Global) и
 * используются `Specialist33DecisionsWorker` (WorkersModule).
 */
@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist33CardHandler],
  exports: [Specialist33CardHandler],
})
export class Specialist33Module {}
