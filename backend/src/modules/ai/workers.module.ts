import { Module } from '@nestjs/common';

import { ChatboxAnalyzeWorker } from '../chatbox/chatbox-analyze.worker';
import { ChatboxSyncWorker } from '../chatbox/chatbox-sync.worker';
import { ChatboxModule } from '../chatbox/chatbox.module';
import { CurationModule } from '../curation/curation.module';
// Pulse Wave 6 §6.3/§6.8 — DashboardModule экспортит DashboardQueueService,
// который @Optional()-инжектится в AnalyzeWorker (для enqueueMeetingRoi после
// ai_ready) и в Specialist33DecisionsWorker (для enqueueDecisionHygiene
// после processBlock).
import { DashboardModule } from '../dashboard/dashboard.module';
// ТЗ-4 Ф7 — DocumentImportWorker инжектит DocumentImportService из
// DocumentsModule (он экспортируется). Воркер очереди `core.document-import`
// крутится in-process.
import { DocumentImportWorker } from '../documents/document-import.worker';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentIngestAdapter } from '../ingest/adapters/document/document.adapter';
import { TextIngestAdapter } from '../ingest/adapters/text/text.adapter';
import { BlockDistillReconcileCron } from '../knowledge-core/workers/block-distill-reconcile.cron';
import { BlockDistillWorker } from '../knowledge-core/workers/block-distill.worker';
import { BlockIngestWorker } from '../knowledge-core/workers/block-ingest.worker';
import { BlockLinkerWorker } from '../knowledge-core/workers/block-linker.worker';
import { CardRollupV2Worker } from '../knowledge-core/workers/card-rollup-v2.worker';
import { EntityGraphBuilderCron } from '../knowledge-core/workers/entity-graph-builder.cron';
import { EntityResolverCronService } from '../knowledge-core/workers/entity-resolver.cron';
import { EntityResolverWorker } from '../knowledge-core/workers/entity-resolver.worker';
import { ExecutablePersonaBuildCron } from '../knowledge-core/workers/executable-persona-build.cron';
import { ExperimentDetectorWorker } from '../knowledge-core/workers/experiment-detector.worker';
import { ExperimentStatusResolverCron } from '../knowledge-core/workers/experiment-status-resolver.cron';
import { ExperimentTransitionsCron } from '../knowledge-core/workers/experiment-transitions.cron';
import { GoalTaskLinkerCron } from '../knowledge-core/workers/goal-task-linker.cron';
import { GoalThemeLinkerCron } from '../knowledge-core/workers/goal-theme-linker.cron';
import { GraphMaterializationVerifyCron } from '../knowledge-core/workers/graph-materialization-verify.cron';
import { IdeaClustererCron } from '../knowledge-core/workers/idea-clusterer.cron';
import { InsightClustererCron } from '../knowledge-core/workers/insight-clusterer.cron';
import { KnowledgeCloneRebuildCron } from '../knowledge-core/workers/knowledge-clone-rebuild.cron';
// ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined (Variant Б+).
import { KnowledgeCloneRebuildWorker } from '../knowledge-core/workers/knowledge-clone-rebuild.worker';
import { MeetingReportFastWorker } from '../knowledge-core/workers/meeting-report-fast.worker';
// TZ clone-method ВАЛ.1 (2026-06-12) — поведенческая валидация persona v1-vs-v2.
import { PersonaLayerValidationCron } from '../knowledge-core/workers/persona-layer-validation.cron';
import { ProcessDetectorWorker } from '../knowledge-core/workers/process-detector.worker';
import { ProcessTemplateCompletenessCron } from '../knowledge-core/workers/process-template-completeness.cron';
import { ReframingCron } from '../knowledge-core/workers/reframing.cron';
// TZ clone-method Э1.2 (2026-06-12) — Reflection-слой принципов роли.
import { RolePrincipleSynthesisCron } from '../knowledge-core/workers/role-principle-synthesis.cron';
import { SkillManagerDigestCron } from '../knowledge-core/workers/skill-manager-digest.cron';
import { SkillProfileRebuildWorker } from '../knowledge-core/workers/skill-profile-rebuild.worker';
import { SkillProfileRecalibrateCron } from '../knowledge-core/workers/skill-profile-recalibrate.cron';
import { SkillTraitConceptNormalizerCron } from '../knowledge-core/workers/skill-trait-concept-normalizer.cron';
import { SkillTraitVerifyCron } from '../knowledge-core/workers/skill-trait-verify.cron';
import { Specialist31RegulationsWorker } from '../knowledge-core/workers/specialist-3-1-regulations.worker';
import { Specialist314GoalsWorker } from '../knowledge-core/workers/specialist-3-14-goals.worker';
import { Specialist32KnowledgeCloneWorker } from '../knowledge-core/workers/specialist-3-2-knowledge-clone.worker';
import { Specialist33DecisionsWorker } from '../knowledge-core/workers/specialist-3-3-decisions.worker';
import { Specialist34ProjectCustomerWorker } from '../knowledge-core/workers/specialist-3-4-project-customer.worker';
import { Specialist35InsightsWorker } from '../knowledge-core/workers/specialist-3-5-insights.worker';
import { Specialist36IdeasWorker } from '../knowledge-core/workers/specialist-3-6-ideas.worker';
import { Specialist37SkillWorker } from '../knowledge-core/workers/specialist-3-7-skill.worker';
import { SpecialistRoutingDispatcherWorker } from '../knowledge-core/workers/specialist-routing-dispatcher.worker';
import { SpecialistsCombinedWorker } from '../knowledge-core/workers/specialists-combined.worker';
import { SprintHelperCron } from '../knowledge-core/workers/sprint-helper.cron';
import { SprintHelperWorker } from '../knowledge-core/workers/sprint-helper.worker';
import { StrategicAlignmentCron } from '../knowledge-core/workers/strategic-alignment.cron';
import { StrategicAlignmentWorker } from '../knowledge-core/workers/strategic-alignment.worker';
import { ThemeClustererCron } from '../knowledge-core/workers/theme-clusterer.cron';
// ТЗ-5 Ф2 — MeetingUploadIngestWorker (ручная загрузка встреч). Инжектит
// MeetingUploadsQueueService из @Global MeetingUploadsModule (enqueue upload-transcribe).
import { MeetingUploadIngestWorker } from '../meeting-uploads/workers/meeting-upload-ingest.worker';
// ТЗ-5 Ф3 — MeetingUploadTranscribeWorker (диаризация загруженной встречи).
// Инжектит VoxService (локальный провайдер этого модуля) + S3/Meetings/Prisma
// из @Global-модулей; ставит встречу в awaiting_speakers БЕЗ анализа (гейт Ф4).
import { MeetingUploadTranscribeWorker } from '../meeting-uploads/workers/meeting-upload-transcribe.worker';
// SBA β-8 — PersonalRelationBuilderWorker.
import { PersonalRelationBuilderWorker } from '../operations/workers/personal-relation-builder.worker';
import { ProcessesModule } from '../processes/processes.module';
import { FaststartWorker } from '../recordings/workers/faststart.worker';
// Ф2 МТЗ — RoleMapBuilderWorker (handler) живёт в RoleMapModule; импортируем
// модуль, чтобы SpecialistRoutingDispatcherWorker мог инжектить handler.
import { RoleMapModule } from '../role-map/role-map.module';
import { TablesModule } from '../tables/tables.module';
import { TableEnrichWorker } from '../tables/workers/table-enrich.worker';
import { TableSyncWorker } from '../tables/workers/table-sync.worker';
import { TrackerModule } from '../tracker/tracker.module';

import { AnthropicService } from './services/anthropic.service';
import { DeepSeekService } from './services/deepseek.service';
import { LlmFallbackService } from './services/llm-fallback.service';
import { MinimaxService } from './services/minimax.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
import { VoxService } from './services/vox.service';
import { AnalyzeWorker } from './workers/analyze.worker';
import { BehaviorMetricsWorker } from './workers/behavior-metrics.worker';
import { CardRollupWorker } from './workers/card-rollup.worker';
import { ClipRenderWorker } from './workers/clip-render.worker';
import { CustomReportWorker } from './workers/custom-report.worker';
import { MeetingSpeakerAnalyzerWorker } from './workers/meeting-speaker-analyzer.worker';
import { MergeWorker } from './workers/merge.worker';
import { NotifyWorker } from './workers/notify.worker';
import { TranscribeWorker } from './workers/transcribe.worker';
import { TranscriptCleanWorker } from './workers/transcript-clean.worker';
import { TranscriptIndexWorker } from './workers/transcript-index.worker';

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
  imports: [
    // SBA α-4 — Layer 4 Curation. BlockLinkerWorker инжектирует ConflictService
    // для авто-создания ConflictItem из IdeaBlockLink(relationType='contradicts').
    CurationModule,
    // SBA α-7 wave 2 — ProcessDetectorWorker + ProcessTemplateCompletenessCron
    // инжектируют ProcessExtractionService / ProcessTemplateProbeService /
    // ProcessTemplateCompletenessService из ProcessesModule.
    ProcessesModule,
    // Wave 3 / Tracker Phase 3 part B — AnalyzeWorker инжектит
    // MeetingExtractActionsService (через @Optional()) для извлечения
    // автозадач из встречи. Импорт нужен, чтобы провайдер был виден в DI.
    TrackerModule,
    // Pulse Wave 6 §6.3/§6.8 — DashboardQueueService нужен AnalyzeWorker
    // (enqueue Meeting-ROI после ai_ready) и Specialist33DecisionsWorker
    // (enqueue Decision-Hygiene после processBlock). Оба инжектят
    // @Optional() — отсутствие импорта в spec-тестах не ломает их.
    DashboardModule,
    // Smart-tables Фаза 2 — TableSyncWorker инжектит TableSyncService из
    // TablesModule (live entitySync воркер). Воркер крутится in-process.
    TablesModule,
    // Ф2 МТЗ — RoleMapBuilderWorker (handler специалиста '3-8-role-map-builder')
    // живёт в RoleMapModule. Импортируем, чтобы SpecialistRoutingDispatcherWorker
    // мог инжектить его через DI. Specialist38HelpfulnessWorker экспортируется из
    // @Global Specialist38HelpfulnessModule — отдельный import не нужен.
    RoleMapModule,
    // ChatBox Фаза 3 — ChatboxSyncWorker инжектит ChatboxSyncService из
    // ChatboxModule (он экспортируется). Воркер очереди `chatbox.sync`
    // крутится in-process.
    ChatboxModule,
    // ТЗ-4 Ф7 — DocumentImportWorker инжектит DocumentImportService из
    // DocumentsModule (экспортируется). Воркер очереди `core.document-import`.
    DocumentsModule,
  ],
  providers: [
    // worker-only сервисы (нет @Global-дома).
    VoxService,
    LlmFallbackService,
    AnthropicService,
    DeepSeekService,
    MinimaxService,
    OpenAiProxyService,

    // AI-pipeline воркеры.
    TranscribeWorker,
    MergeWorker,
    AnalyzeWorker,
    NotifyWorker,
    TranscriptIndexWorker,
    ClipRenderWorker,
    CardRollupWorker,
    // Фаза B — поведенческие метрики (отдельный воркер параллельно ai.analyze).
    BehaviorMetricsWorker,
    // Pulse Wave 4 §4.4 — Meeting-Speaker-Analyzer. Hourly cron, обрабатывает
    // MeetingParticipantBehavior с sentimentTextPerSpeakerJson IS NULL за
    // последние 24ч завершённых встреч. ТОЛЬКО текст транскрипта (EU AI Act §1.3).
    MeetingSpeakerAnalyzerWorker,
    // Фаза D — очистка транскрипта от слов-паразитов.
    TranscriptCleanWorker,
    // Фаза E — дополнительные («custom») AI-отчёты по выбранному шаблону.
    CustomReportWorker,
    // ТЗ 2026-06-03 meeting-recording-reliability, Фаза 3 — faststart-постобработка
    // composite MP4 (ffmpeg -movflags +faststart). Consumer `recording.faststart`,
    // producer — webhook egress_ended(composite) при RECORDING_FASTSTART_ENABLED.
    FaststartWorker,
    // ТЗ-5 Ф2 — ingest-воркер ручной загрузки встреч. Consumer
    // `meeting.upload-ingest`: ffprobe → нормализация аудио (mono 16к opus) +
    // faststart нативного видео; Recording(ready); FSM до recording_ready;
    // enqueue meeting.upload-transcribe (воркер очереди transcribe — Ф3).
    // Concurrency=1 (ffmpeg тяжёлый), идемпотентен (FSM-guard + фикс. jobId).
    MeetingUploadIngestWorker,
    // ТЗ-5 Ф3 — transcribe-воркер ручной загрузки встреч. Consumer
    // `meeting.upload-transcribe`: Vox(diarization) → Transcript.turns +
    // MeetingUploadSpeaker[]; FSM до awaiting_speakers. ГЕЙТ: анализ НЕ ставит
    // (после ручной разметки спикеров — Ф4 — встреча уходит в ai_processing).
    // Concurrency=1, идемпотентен (FSM-guard + фикс. jobId + upsert).
    MeetingUploadTranscribeWorker,

    // knowledge-core воркеры/cron'ы.
    BlockIngestWorker,
    BlockDistillWorker,
    EntityResolverWorker,
    EntityResolverCronService,
    BlockLinkerWorker,
    EntityGraphBuilderCron,
    // Agent-chain overhaul Фаза 0a (2026-06-07) — cron `*/30 * * * *`:
    // догоночная наблюдаемость материализации графа. READ-ONLY: по недавним
    // встречам (24ч) считает расхождения (блоки decision/idea есть, записи нет)
    // → метрика kc_materialization_gap_total + WARN-лог. GraphMaterializationService
    // берётся из @Global KnowledgeCoreModule.
    GraphMaterializationVerifyCron,
    // Аудит-баг Б4 (high, класс K7) — cron каждые 30 мин: реконсиляция
    // застрявших draft-блоков. block-ingest.worker помечает RawEvent=ingested
    // ДО best-effort enqueueBlockDistill; краш/сбой Redis между ними оставляет
    // блок навсегда в status='draft' (повторный заход — ранний skip). Этот cron
    // догоняет: находит draft старше 10 мин и идемпотентно ре-enqueue'ит distill
    // (jobId-дедуп + skip not-draft в distill-worker). WorkerOrgGate / CoreQueue —
    // из @Global CoreQueueModule.
    BlockDistillReconcileCron,
    // Agent-chain overhaul Фаза 4.2 (2026-06-07) — cron каждые 30 мин:
    // догоночная авто-привязка тем к AI-целям без единой темы (провенанс +
    // co-mention, GoalTheme source='ai'). Закрывает «0 тем», из-за которых
    // strategic-alignment.worker делал ранний return. GoalThemeLinkerService
    // берётся из @Global KnowledgeCoreModule, WorkerOrgGate — из @Global CoreQueueModule.
    GoalThemeLinkerCron,
    // Agent-chain overhaul Фаза 4.1 (2026-06-08) — cron каждые 30 мин:
    // догоночная LLM-привязка задач встречи к свежим AI-целям (createdAt>=now-7д).
    // За флагом goals.goalTaskLinkEnabled (DEFAULT OFF) — линкер сам no-op при
    // выключенном флаге / отсутствии ungoaled-задач. Non-destructive. Сервис из
    // @Global KnowledgeCoreModule, WorkerOrgGate — из @Global CoreQueueModule.
    GoalTaskLinkerCron,
    ReframingCron,
    ThemeClustererCron,
    CardRollupV2Worker,
    // SBA α-6 — consumer `core.specialist-routing` jobName='3-4-project-customer'.
    // Матчит блок→карточки и публикует rollup-job'ы с дебаунсом 60s.
    Specialist34ProjectCustomerWorker,
    // SBA α-7 — consumer `core.specialist-routing` jobName='3-1-regulations'.
    // Извлекает Regulation/Process/Policy из блоков и публикует triage.
    Specialist31RegulationsWorker,
    // SBA α-7 wave 2 — consumer `core.specialist-routing` jobName='3-1-process-detector'.
    // Батчит блоки signalType=process_step|methodology_step и извлекает
    // ProcessTemplate-кандидатов через LLM (одним пакетом). Завязан на
    // ProcessExtractionService из ProcessesModule.
    ProcessDetectorWorker,
    // SBA α-7 wave 2 — cron `0 3 * * *`: ежедневный пересчёт completeness
    // ProcessTemplate'ов + обновление gauge'ев Prometheus.
    ProcessTemplateCompletenessCron,
    // SBA β-2 — consumer `core.specialist-routing` jobName='3-2-knowledge-clone'.
    // Матчит блок → Person'ы (employee) и enqueue rebuild knowledgeProfile.
    Specialist32KnowledgeCloneWorker,
    // SBA β-2 — consumer `core.knowledge-clone-rebuild` jobName='rebuild-knowledge-profile'.
    // Гоняет LLM extract+merge, отдаёт в triage, пишет в Person.knowledgeProfile.
    KnowledgeCloneRebuildWorker,
    // SBA β-2 — cron `0 *\/6 * * *`: пересборка профилей сотрудников
    // со свежей активностью за неделю.
    KnowledgeCloneRebuildCron,
    // TZ clone-method Э1.2 — cron `30 5 * * *` (Redis-lock): синтез принципов
    // процесса должности (`RolePrinciple`) из reasoning-блоков носителей,
    // sweep Org→Role с общим бюджетом 100 ролей. Kill-switch
    // ROLE_PRINCIPLE_SYNTHESIS_ENABLED (ON).
    RolePrincipleSynthesisCron,
    // TZ clone-method ВАЛ.1 — cron `0 7 * * SUN` (Redis-lock, после
    // persona-build 06:00 SUN): поведенческая валидация persona v1-vs-v2 на
    // реальных кейсах роли через LLM-judge; sweep Org→Role (только роли с
    // активной role-persona) с бюджетом 10 ролей. Только метрика
    // clone_persona_layer_score{variant} + лог — ничего не блокирует (R10).
    // Kill-switch PERSONA_LAYER_VALIDATION_ENABLED (ON).
    PersonaLayerValidationCron,
    // SBA β-3 — consumer `core.specialist-routing` jobName='3-3-decisions'.
    // Извлекает Decision из блоков (decision/rationale/decision_basis),
    // KNN+LLM supersede-detect, triage (deep review всегда).
    Specialist33DecisionsWorker,
    // SBA β-4 — consumer `core.specialist-routing` jobName='3-5-insights'.
    // KNN-кластеризация повторов pain/risk/churn_risk/objection в Insight,
    // LLM extract + linking с Decisions, triage (critical → deep review).
    Specialist35InsightsWorker,
    // SBA β-4 — cron `0 *‎/6 * * *`: пересчёт frequency/dynamic + probe
    // no_mitigation_plan + gauge insights_dynamic_label_count.
    InsightClustererCron,
    // SBA β-6 — consumer `core.specialist-routing` jobName='3-9-experiments'.
    // LLM-extract Experiment'а из signalType ∈ {hypothesis, result, lesson},
    // persist + ExperimentVersion snapshot, triage, probe.result_without_lesson.
    ExperimentDetectorWorker,
    // SBA β-6 — cron `0 *‎/6 * * *`: auto-status transitions при confidence ≥ 0.7,
    // probe.no_owner + probe.running_too_long, gauge experiments_total.
    ExperimentStatusResolverCron,
    // SBA β-6 — cron `0 7 * * *`: эмит EntityLink predicates
    // (result_supports_insight, lesson_informs_decision) для completed-экспериментов.
    ExperimentTransitionsCron,
    // SBA β-5 — consumer `core.specialist-routing` jobName='3-6-ideas'.
    // KNN-дедуп Idea, LLM extract, weight/supporters, EventEmitter
    // 'idea.created'.
    Specialist36IdeasWorker,
    // Goals OKR v2 (2026-06-02, Фаза 2) — consumer `core.specialist-routing`
    // jobName='3-14-goals'. Авто-добыча целей из блоков commitment/plan_item:
    // LLM goal-extract → KNN-дедуп → goal-hierarchy-link → Goal(source='ai').
    Specialist314GoalsWorker,
    // SBA β-5 — cron `30 *‎/4 * * *`: кластеризация Idea → IdeaCluster
    // (KNN + LLM idea-cluster-merge на критической массе).
    IdeaClustererCron,
    // SBA γ-1 — consumer `core.specialist-routing` jobName='3-7-skill'.
    // Матчит subject-reasoning блок → SkillProfile и enqueue rebuild.
    Specialist37SkillWorker,
    // SBA γ-1 — consumer `core.skill-profile-rebuild`. Гоняет KNN-группировку
    // блоков, LLM skill-trait-detect + skill-trait-merge, decay,
    // probe-events. Пишет SkillTrait в БД.
    SkillProfileRebuildWorker,
    // SBA γ-1 — cron `0 5 * * *`: daily decay confidence + archive старых traits.
    SkillProfileRecalibrateCron,
    // Ф3(D) clone-quality-improvements (2026-06-08) — cron `30 3 * * *`:
    // grounding-проверка pending_verification черт перед персоной
    // (grounded → active; иначе pending; fail-open promote при ошибке LLM).
    SkillTraitVerifyCron,
    // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — cron `0 3 * * *`:
    // нормализация Смысловых блоков навыка (slияние близких SkillTraitConcept,
    // архивация без активных traits старше N месяцев). За час до decay-cron.
    SkillTraitConceptNormalizerCron,
    // SBA γ-1 — cron `0 6 * * SUN`: weekly сборка ExecutablePersona snapshots
    // (scope='person' + scope='role' aggregation).
    ExecutablePersonaBuildCron,
    // SBA γ-1 — cron `0 9 * * MON`: weekly digest direct manager'ам про
    // новые SkillTrait'ы у подчинённых.
    SkillManagerDigestCron,
    // ТЗ 2026-05-25 — meeting-report-fast.
    // Consumer `core.meeting-report-fast`: один LLM-вызов по СЫРОМУ
    // транскрипту → chapters + tasks + summaryFast + qualityScore.
    MeetingReportFastWorker,
    // ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined.
    // Consumer `core.specialists-combined`. Под flag-rollout
    // `SPECIALISTS_COMBINED_ENABLED` (default false). Producer (cron) удалён
    // вместе с v2-стеком — на 2026-06-10 enqueue только вручную/из тестов.
    SpecialistsCombinedWorker,
    // Ф2 МТЗ «разблокировка конвейера» — ЕДИНЫЙ Worker очереди
    // `core.specialist-routing`. Делегирует job по `job.name` в нужный
    // специалист-handler (Map<jobName, handler>). Раньше на этой очереди
    // поднималось 14 конкурирующих Worker'ов → ~13/14 блоков молча терялись.
    // Хендлеры из других модулей: Specialist38HelpfulnessWorker (@Global
    // Specialist38HelpfulnessModule), RoleMapBuilderWorker (RoleMapModule, см.
    // imports). Остальные 12 — провайдеры этого модуля.
    SpecialistRoutingDispatcherWorker,
    StrategicAlignmentWorker,
    StrategicAlignmentCron,

    // SBA β-8 — consumer `core.specialist-routing` jobName='3-12-personal-relation'.
    // Извлекает межличностные EntityLink ('conflicted_with') из блоков
    // signalType ∈ {team_friction, process_friction}. На β-8 — упрощённая
    // pairwise-логика; γ-2 переделает на полноценный LLM extract пары + role.
    PersonalRelationBuilderWorker,

    // Фаза 0b knowledge-core: ingest-адаптеры документов и дампов.
    DocumentIngestAdapter,
    TextIngestAdapter,
    // ТЗ-4 Ф7 — consumer `core.document-import`. По importId распаковывает ZIP
    // и создаёт Document'ы (re-use DocumentsService.createOne + dedup + enqueue
    // core.document-uploaded). Идемпотентно (status-guard в processImport).
    DocumentImportWorker,

    // Sprints (2026-05-27, plans/tz/2026-05-27-sprints.md §2.4 §2.6) —
    // Specialist 3-13: consumer `core.specialist-routing` jobName='3-13-sprint-helper'
    // и cron каждые 4 часа по активным циклам.
    SprintHelperWorker,
    SprintHelperCron,

    // Smart-tables Фаза 2 — consumer `tables.sync`. Поддерживает строки
    // системных entitySync-таблиц в актуальном состоянии при изменениях графа.
    TableSyncWorker,
    // Smart-tables Фаза 3 — consumer `tables.enrich` (Event-to-Cells). После
    // `meeting.ai_ready` извлекает факты из транскрипта и патчит ПУСТЫЕ ячейки
    // sync-таблиц; спорное — в очередь подтверждений.
    TableEnrichWorker,

    // ChatBox Фаза 3 — consumer `chatbox.sync`. Делегирует в ChatboxSyncService
    // (syncByScope / incrementalSync). Producer — ChatboxSyncQueueService
    // (ручной триггер из `POST /chatbox/integration/sync`).
    ChatboxSyncWorker,
    // ChatBox Фаза 5 — consumer `chatbox.analyze`. Анализирует закрытую сессию:
    // LLM-summary + мост в knowledge-core (RawEvent). Producer'ы —
    // ChatboxAnalyzeQueueService (cron-sweeper + webhook/синк при закрытии).
    ChatboxAnalyzeWorker,
  ],
})
export class WorkersModule {}
