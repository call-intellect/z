import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist35CardHandler } from './services/specialist-3-5-card-handler.service';

/**
 * SBA β-4 — модуль регистрации специалиста 3.5 (Insights Radar) в
 * `CardSpecialistRegistry`.
 *
 * По образцу `Specialist33Module` (β-3): вынесен отдельно от
 * `KnowledgeCoreModule`, чтобы не создавать зависимость KnowledgeCoreModule
 * → ChatV2Module.
 *
 * Содержит только `Specialist35CardHandler`, который в `onModuleInit`
 * вызывает `cardSpecialistRegistry.register('3-5-insights', this)`.
 *
 * Регистрируется в `AppModule` ПОСЛЕ `ChatV2Module` (где живёт
 * `CardSpecialistRegistry`).
 *
 * NB: сам `Specialist35Service` (LLM-extract → KNN-кластеризация → triage),
 * а также `Specialist35ProbeService` живут внутри `KnowledgeCoreModule`
 * (Global) и используются `Specialist35InsightsWorker` (WorkersModule).
 */
@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist35CardHandler],
  exports: [Specialist35CardHandler],
})
export class Specialist35Module {}
