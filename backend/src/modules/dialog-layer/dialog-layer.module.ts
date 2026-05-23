import { Global, Module } from '@nestjs/common';

import { AnswerCacheService } from './services/answer-cache.service';
import { CacheInvalidationService } from './services/cache-invalidation.service';
import { ConfidenceEstimatorService } from './services/confidence-estimator.service';
import { ContextualizerService } from './services/contextualizer.service';
import { DialogService } from './services/dialog.service';
import { MultiQueryExpansionService } from './services/multi-query-expansion.service';
import { QueryClassifierService } from './services/query-classifier.service';
import { RetrievalCacheService } from './services/retrieval-cache.service';
import { ConversationSummarizerCron } from './workers/conversation-summarizer.cron';

/**
 * SBA α-5 dialog-layer — препроцессор chat-v2.
 *
 * @Global — DialogService и cache-сервисы инъектируются в chat-v2 модуль и
 * (опционально) в admin-эндпоинты, без явного import'а.
 *
 * Зависит от (через @Global):
 *   - PrismaService (database)
 *   - RedisService (cache backend)
 *   - LlmRouterService (AiModule, @Global) — все 5 LLM-задач
 *   - BusinessMetricsService
 *   - TypedConfigService
 *   - @nestjs/event-emitter (EventEmitterModule.forRoot() — для CacheInvalidationService)
 *
 * См. plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md.
 */
@Global()
@Module({
  providers: [
    ContextualizerService,
    ConfidenceEstimatorService,
    QueryClassifierService,
    MultiQueryExpansionService,
    AnswerCacheService,
    RetrievalCacheService,
    DialogService,
    CacheInvalidationService,
    ConversationSummarizerCron,
  ],
  exports: [
    DialogService,
    AnswerCacheService,
    RetrievalCacheService,
    CacheInvalidationService,
    // SBA β-1 zero-button (2026-05-23): экспорт нужен Telegram/MAX-адаптерам,
    // чтобы напрямую вызывать QueryClassifierService.classify() без полного
    // DialogService.process() — у них нет conversationId и нет нужды
    // в контекстуализации.
    QueryClassifierService,
  ],
})
export class DialogLayerModule {}
