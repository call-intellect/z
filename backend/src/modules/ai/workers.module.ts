import { Module } from '@nestjs/common';

import { DocumentIngestAdapter } from '../ingest/adapters/document/document.adapter';
import { TextIngestAdapter } from '../ingest/adapters/text/text.adapter';
import { BlockDistillWorker } from '../knowledge-core/workers/block-distill.worker';
import { BlockIngestWorker } from '../knowledge-core/workers/block-ingest.worker';
import { BlockLinkerWorker } from '../knowledge-core/workers/block-linker.worker';
import { CardRollupV2Worker } from '../knowledge-core/workers/card-rollup-v2.worker';
import { EntityGraphBuilderCron } from '../knowledge-core/workers/entity-graph-builder.cron';
import { EntityResolverCronService } from '../knowledge-core/workers/entity-resolver.cron';
import { EntityResolverWorker } from '../knowledge-core/workers/entity-resolver.worker';
import { MeetingAnalyzeV2Cron } from '../knowledge-core/workers/meeting-analyze-v2.cron';
import { MeetingAnalyzeV2Worker } from '../knowledge-core/workers/meeting-analyze-v2.worker';
import { ReframingCron } from '../knowledge-core/workers/reframing.cron';
import { StrategicAlignmentCron } from '../knowledge-core/workers/strategic-alignment.cron';
import { StrategicAlignmentWorker } from '../knowledge-core/workers/strategic-alignment.worker';
import { ThemeClustererCron } from '../knowledge-core/workers/theme-clusterer.cron';

import { AnalyzeWorker } from './workers/analyze.worker';
import { BehaviorMetricsWorker } from './workers/behavior-metrics.worker';
import { CardRollupWorker } from './workers/card-rollup.worker';
import { ChaptersWorker } from './workers/chapters.worker';
import { ClipRenderWorker } from './workers/clip-render.worker';
import { CustomReportWorker } from './workers/custom-report.worker';
import { MergeWorker } from './workers/merge.worker';
import { NotifyWorker } from './workers/notify.worker';
import { QualityScoreWorker } from './workers/quality-score.worker';
import { TasksExtractWorker } from './workers/tasks-extract.worker';
import { TranscribeWorker } from './workers/transcribe.worker';
import { TranscriptCleanWorker } from './workers/transcript-clean.worker';
import { TranscriptIndexWorker } from './workers/transcript-index.worker';
import { AnthropicService } from './services/anthropic.service';
import { LlmFallbackService } from './services/llm-fallback.service';
import { MinimaxService } from './services/minimax.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
import { VoxService } from './services/vox.service';

/**
 * WorkersModule — AI- и knowledge-core-воркеры/cron'ы.
 *
 * Запускаются IN-PROCESS внутри основного backend'а (импортируется в AppModule).
 * Отдельного worker-процесса больше нет — это упрощает деплой и DI: воркеры
 * берут все сервисы из @Global-модулей приложения (Ai / KnowledgeCore / Meetings
 * / Recordings / Ingest / CoreQueue / Audit / Entitlements / Quotas / Embeddings /
 * Metrics). BullMQ Worker'ы регистрируются в `onModuleInit` каждого провайдера.
 *
 * Локально провайдим только worker-only сервисы, у которых нет @Global-дома:
 *   - VoxService (ASR) — нужен TranscribeWorker'у;
 *   - LlmFallbackService + его LLM-клиенты (Anthropic/Minimax/OpenAiProxy) — AnalyzeWorker'у.
 */
@Module({
  providers: [
    // worker-only сервисы (нет @Global-дома).
    VoxService,
    LlmFallbackService,
    AnthropicService,
    MinimaxService,
    OpenAiProxyService,

    // AI-pipeline воркеры.
    TranscribeWorker,
    MergeWorker,
    AnalyzeWorker,
    NotifyWorker,
    ChaptersWorker,
    TasksExtractWorker,
    TranscriptIndexWorker,
    ClipRenderWorker,
    CardRollupWorker,
    // Фаза B — поведенческие метрики (отдельный воркер параллельно ai.analyze).
    BehaviorMetricsWorker,
    // Фаза C — AI-оценка качества встречи.
    QualityScoreWorker,
    // Фаза D — очистка транскрипта от слов-паразитов.
    TranscriptCleanWorker,
    // Фаза E — дополнительные («custom») AI-отчёты по выбранному шаблону.
    CustomReportWorker,

    // knowledge-core воркеры/cron'ы.
    BlockIngestWorker,
    BlockDistillWorker,
    EntityResolverWorker,
    EntityResolverCronService,
    BlockLinkerWorker,
    EntityGraphBuilderCron,
    ReframingCron,
    ThemeClustererCron,
    CardRollupV2Worker,
    MeetingAnalyzeV2Worker,
    MeetingAnalyzeV2Cron,
    StrategicAlignmentWorker,
    StrategicAlignmentCron,

    // Фаза 0b knowledge-core: ingest-адаптеры документов и дампов.
    DocumentIngestAdapter,
    TextIngestAdapter,
  ],
})
export class WorkersModule {}
