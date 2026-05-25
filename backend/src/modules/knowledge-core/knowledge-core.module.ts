import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';
import { S3Service } from '../recordings/s3.service';

import { SearchService } from './api/search.service';
import { BlockExtractionService } from './services/block-extraction.service';
import { BlockFetchService, KnowledgeBlockResolver } from './services/block-fetch.service';
import { BlockLinkService } from './services/block-link.service';
import { BlockMergeService } from './services/block-merge.service';
import { CardRollupV2Service } from './services/card-rollup-v2.service';
import { ChaptersExtractorV2Service } from './services/chapters-extractor-v2.service';
import { DataClassPolicyService } from './services/dataclass-policy.service';
import { ChatV2RetrievalService } from './services/chat-v2-retrieval.service';
import { ChatV2Service } from './services/chat-v2.service';
import { ClusteringService } from './services/clustering.service';
import { KnowledgeEmbeddingService } from './services/embedding.service';
import { EntityGraphService } from './services/entity-graph.service';
import { EntityMergeService } from './services/entity-merge.service';
import { EntityResolutionService } from './services/entity-resolution.service';
import { FactSupersedeService } from './services/fact-supersede.service';
import { AxisClassifierService } from './services/axis-classifier.service';
import { RouterService } from './services/router.service';
import { SegmentBuilderService } from './services/segment-builder.service';
import { SkillTraitConceptService } from './services/skill-trait-concept.service';
import { Specialist31ProbeService } from './services/specialist-3-1-probe.service';
import { Specialist31Service } from './services/specialist-3-1-regulations.service';
import { Specialist32Service } from './services/specialist-3-2-knowledge-clone.service';
import { Specialist32ProbeService } from './services/specialist-3-2-probe.service';
import { Specialist33Service } from './services/specialist-3-3-decisions.service';
import { Specialist33ProbeService } from './services/specialist-3-3-probe.service';
import { Specialist34ProbeService } from './services/specialist-3-4-probe.service';
import { Specialist35Service } from './services/specialist-3-5-insights.service';
import { Specialist35ProbeService } from './services/specialist-3-5-probe.service';
import { Specialist36Service } from './services/specialist-3-6-ideas.service';
import { Specialist36ProbeService } from './services/specialist-3-6-probe.service';
import { Specialist37Service } from './services/specialist-3-7-skill.service';
import { Specialist37ProbeService } from './services/specialist-3-7-skill-probe.service';
import { Specialist39ExperimentProbeService } from './services/specialist-3-9-experiment-probe.service';
import { Specialist39ExperimentsService } from './services/specialist-3-9-experiments.service';
import { ExecutablePersonaBuildService } from './services/executable-persona-build.service';
import { ExecutablePersonaVersioningService } from './services/executable-persona-versioning.service';
import { RoleClonePersonaVersioningHandler } from './services/role-clone-persona-versioning.handler';
import { ExecutablePersonaTriggerWatcherCron } from './workers/executable-persona-trigger-watcher.cron';
import { SummaryExtractorV2Service } from './services/summary-extractor-v2.service';
import { TaskAssigneeResolverService } from './services/task-assignee-resolver.service';
import { TasksExtractorV2Service } from './services/tasks-extractor-v2.service';
import { ThemeClassificationService } from './services/theme-classification.service';
import { CoreMetricsSnapshotCron } from './workers/core-metrics-snapshot.cron';
// W2.2 + W2.3 + W2.4 + G.2 + W4.2 KC-Temporal (2026-05-25).
import { ConfidenceCalibrationService } from './services/confidence-calibration.service';
import { PreferenceDatasetService } from './services/preference-dataset.service';
import { TemporalProbeService } from './services/temporal-probe.service';
import { ConfidenceCalibrationCron } from './workers/confidence-calibration.cron';
import { TemporalProbeCron } from './workers/temporal-probe.cron';
import { SignalTypeStatsCron } from './workers/signal-type-stats.cron';
import { DataClassAuditSnapshotCron } from './workers/dataclass-audit-snapshot.cron';

/**
 * KnowledgeCoreModule — оркестрация ingest → distill для IdeaBlock'ов.
 *
 * Содержит только сервисы (не воркеры — они зарегистрированы в WorkersModule
 * и поднимаются в worker-процессе через `bun run worker:dev`).
 *
 * Зависимости (берём через глобальные DI-провайдеры):
 *   - `LlmRouterService` — из `AiModule` (Global, на HTTP-side) или
 *     зарегистрирован напрямую в `WorkersModule`.
 *   - `EmbeddingFallbackService` — из `EmbeddingsModule` (импортируется и в
 *     AiModule, и в WorkersModule).
 *   - `CoreQueueService` — из `CoreQueueModule` (Global).
 *   - `PrismaModule`, `RedisModule` — глобальные.
 *   - `S3Service` — provider'им локально (модуль recordings — HTTP-only).
 *
 * Помечаем `@Global()`, чтобы воркеры в `WorkersModule` могли инжектить
 * `BlockExtractionService` / `EntityResolutionService` / `SegmentBuilderService`
 * без явного импорта самого модуля несколько раз.
 *
 * HTTP-контроллеры вынесены в `KnowledgeCoreApiModule` — чтобы worker-процесс,
 * импортирующий этот сервис-модуль, не инстанцировал контроллеры и их auth-guard'ы
 * (CookieAuthGuard/TenantGuard), которым в воркере нет места.
 */
@Global()
@Module({
  // SBA α-6 — CurationModule подключаем здесь, чтобы `CardRollupV2Service`
  // мог инжектить `CurationService.triage()` и `ConflictService.report()`.
  imports: [ConfigModule, PrismaModule, CurationModule],
  providers: [
    // Clones=Roles Ф2 (2026-05-25) — handler `role.bearer_changed`. Ставим
    // первым providers'ом: в момент onModuleInit Nest регистрирует @OnEvent —
    // важно, чтобы handler был готов до первых emit'ов.
    RoleClonePersonaVersioningHandler,
    S3Service,
    SegmentBuilderService,
    BlockExtractionService,
    KnowledgeEmbeddingService,
    EntityResolutionService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    EntityGraphService,
    SearchService,
    // Фаза 4: Theme + clusterer + card-rollup-v2.
    ClusteringService,
    ThemeClassificationService,
    CardRollupV2Service,
    // Фаза 5: meeting-analyze-v2 (Tasks-2.0/Chapters-2.0/Summary-2.0).
    BlockFetchService,
    // KC-Temporal W1.1 (2026-05-25) — резолвер активных IdeaBlock'ов
    // (validUntil IS NULL или validFrom<=at<validUntil). Используется
    // search/snapshot/graph слоями. Без ENV-флага — это чистый helper.
    KnowledgeBlockResolver,
    TasksExtractorV2Service,
    ChaptersExtractorV2Service,
    SummaryExtractorV2Service,
    // ТЗ 2026-05-25 hard-participant-identification — резолвер
    // Task.assigneeUserId на выходе LLM (fallback по имени + защита от
    // галлюцинаций). Используется meeting-analyze-v2 и tasks-extract воркерами.
    TaskAssigneeResolverService,
    // Фаза 6: ChatV2 (единый AI-чат поверх IdeaBlock'ов, 5 scope).
    ChatV2RetrievalService,
    ChatV2Service,
    // Фаза 11: snapshot-cron для core_* gauge'ев.
    CoreMetricsSnapshotCron,
    // SBA α-3: RouterService — диспатч атомов в специалистов Слоя 3.
    RouterService,
    // SBA α-3 wave 3: AxisClassifierService — fan-out IdeaBlock по 4 осям.
    AxisClassifierService,
    // SBA α-6: Specialist34ProbeService — probe-events специалиста 3.4.
    Specialist34ProbeService,
    // SBA α-7: Specialist31Service — extraction/dedupe/triage для регламентов
    // и процессов; Specialist31ProbeService — probe-events.
    Specialist31Service,
    Specialist31ProbeService,
    // SBA β-2: Specialist32Service (rebuild knowledgeProfile через LLM
    // extract+merge+triage) и Specialist32ProbeService (probe-events
    // new_expertise_detected / contradiction_detected).
    Specialist32Service,
    Specialist32ProbeService,
    // SBA β-3: Specialist33Service (extract → KNN → supersede-detect → triage)
    // и Specialist33ProbeService (5 probe-trigger'ов + daily cron для
    // overdue / outcome_unknown).
    Specialist33Service,
    Specialist33ProbeService,
    // SBA β-4: Specialist35Service (KNN-кластеризация → LLM extract → linking
    // с Decisions → triage) и Specialist35ProbeService (4 probe-trigger'а).
    Specialist35Service,
    Specialist35ProbeService,
    // SBA β-6: Specialist39ExperimentsService (Experiment Tracker — extract
    // hypothesis/result/lesson → persist + ExperimentVersion → triage) и
    // Specialist39ExperimentProbeService (3 probe-trigger'а: no_owner,
    // running_too_long, result_without_lesson).
    Specialist39ExperimentsService,
    Specialist39ExperimentProbeService,
    // SBA β-5: Specialist36Service (Ideas Collector — KNN-дедуп Idea, LLM
    // extract, weight/supporters, EventEmitter idea.created/idea.status_changed)
    // и Specialist36ProbeService (probe.support_request + probe.status_unclear).
    Specialist36Service,
    Specialist36ProbeService,
    // SBA γ-1: Specialist37Service (SkillProfile rebuild — KNN-группировка
    // reasoning-блоков → LLM detect → KNN-merge → decay) и
    // Specialist37ProbeService (skill.profile_starved / contradicting_traits) +
    // ExecutablePersonaBuildService (compile persona snapshots для Clone API).
    Specialist37Service,
    Specialist37ProbeService,
    ExecutablePersonaBuildService,
    // SBA γ-1 доделки: ExecutablePersonaVersioningService + trigger-watcher cron.
    ExecutablePersonaVersioningService,
    ExecutablePersonaTriggerWatcherCron,
    // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — Смысловые блоки навыка.
    SkillTraitConceptService,
    // W4.1 (2026-05-25 KC-Temporal) — DataClassPolicyService.
    // Single source of truth для DataClass derive. На W4.1 работает в
    // shadow-режиме: специалисты вызывают `compareWithLegacy` рядом с
    // легаси-вычислением; реальный write пока legacy. См. ТЗ §W4.1.
    DataClassPolicyService,
    // KC-Temporal W1.2 (2026-05-25) — FactSupersedeService.
    // Запускается best-effort из BlockDistillWorker после markCanonical
    // при cfg.bitemporal.enabled && cfg.bitemporal.supersedeEnabled.
    FactSupersedeService,
    // ── KC-Temporal волна 2 + G.2 + W4.2 (2026-05-25) ──
    // Добавлено в конец providers, чтобы минимизировать конфликт с S3.B
    // (clones-related изменениями в этой же фазе).
    ConfidenceCalibrationService,
    PreferenceDatasetService,
    TemporalProbeService,
    ConfidenceCalibrationCron,
    TemporalProbeCron,
    SignalTypeStatsCron,
    DataClassAuditSnapshotCron,
  ],
  exports: [
    SegmentBuilderService,
    BlockExtractionService,
    KnowledgeEmbeddingService,
    EntityResolutionService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    EntityGraphService,
    SearchService,
    ClusteringService,
    ThemeClassificationService,
    CardRollupV2Service,
    // Фаза 5: экспортируем для воркеров (`MeetingAnalyzeV2Worker` и
    // `MeetingAnalyzeV2Cron` живут в WorkersModule).
    BlockFetchService,
    // KC-Temporal W1.1 — экспортируется для consumer'ов (search/snapshot/graph).
    KnowledgeBlockResolver,
    TasksExtractorV2Service,
    ChaptersExtractorV2Service,
    SummaryExtractorV2Service,
    TaskAssigneeResolverService,
    // Фаза 6: ChatV2 экспортируется, чтобы chat.service из ChatModule мог
    // его инжектить (этот модуль @Global, поэтому импортирует прозрачно).
    ChatV2RetrievalService,
    ChatV2Service,
    // SBA α-3: экспортируем RouterService — block-ingest worker инжектит его
    // для dispatch'а после persist'а блока.
    RouterService,
    // SBA α-3 wave 3: экспортируем AxisClassifierService — block-ingest worker
    // дёргает его сразу после router.dispatch.
    AxisClassifierService,
    // SBA α-6: экспортируем для CardSpecialistRegistry-регистрации и тестов.
    Specialist34ProbeService,
    // SBA α-7: экспортируем для Worker'а и тестов.
    Specialist31Service,
    Specialist31ProbeService,
    // SBA β-2: экспортируем — KnowledgeCloneRebuildWorker и
    // Specialist32KnowledgeCloneWorker (WorkersModule) их инжектят.
    Specialist32Service,
    Specialist32ProbeService,
    // SBA β-3: экспортируем для Specialist33DecisionsWorker (WorkersModule)
    // и REST API DecisionsModule (через PrismaService — но для тестов
    // удобно иметь явный export).
    Specialist33Service,
    Specialist33ProbeService,
    // SBA β-4: экспортируем для Specialist35InsightsWorker / InsightClustererCron
    // (WorkersModule) и REST API InsightsModule.
    Specialist35Service,
    Specialist35ProbeService,
    // SBA β-6: экспортируем для ExperimentDetectorWorker / ExperimentStatusResolverCron
    // (WorkersModule) и REST API ExperimentsModule.
    Specialist39ExperimentsService,
    Specialist39ExperimentProbeService,
    // SBA β-5: экспортируем для Specialist36IdeasWorker / IdeaClustererCron
    // (WorkersModule) и REST API IdeasModule + Specialist36Module.
    Specialist36Service,
    Specialist36ProbeService,
    // SBA γ-1: экспортируем — Specialist37SkillWorker / SkillProfileRebuildWorker
    // (WorkersModule), ClonesService (ClonesModule) и тесты инжектят.
    Specialist37Service,
    Specialist37ProbeService,
    ExecutablePersonaBuildService,
    // SBA γ-1 доделки.
    ExecutablePersonaVersioningService,
    // Clones=Roles Ф2 — экспорт handler'а, чтобы admin force-new-version API
    // мог напрямую вызвать `handle(...)`.
    RoleClonePersonaVersioningHandler,
    // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — экспортируется,
    // чтобы admin-модуль / cron-нормализатор / backfill-скрипт могли инжектить.
    SkillTraitConceptService,
    // W4.1 — экспортируется для специалистов 3.1–3.6 (shadow-вызовы) и
    // будущих enforce-call'ов на W4.2 + W4.3.
    DataClassPolicyService,
    // KC-Temporal W1.2 — экспортируется для BlockDistillWorker (WorkersModule)
    // и тестов.
    FactSupersedeService,
    // KC-Temporal волна 2 + G.2 + W4.2 — экспортируем для admin-эндпоинтов
    // (preference-dataset download) + integration-тестов.
    ConfidenceCalibrationService,
    PreferenceDatasetService,
    TemporalProbeService,
  ],
})
export class KnowledgeCoreModule {}
