import { Module } from '@nestjs/common';

import { CurationModule } from '../curation/curation.module';
import { ProcessesModule } from '../processes/processes.module';
import { TrackerModule } from '../tracker/tracker.module';
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
import { MeetingReportFastWorker } from '../knowledge-core/workers/meeting-report-fast.worker';
// ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined (Variant Б+).
import { SpecialistsCombinedWorker } from '../knowledge-core/workers/specialists-combined.worker';
import { ReframingCron } from '../knowledge-core/workers/reframing.cron';
import { KnowledgeCloneRebuildCron } from '../knowledge-core/workers/knowledge-clone-rebuild.cron';
import { KnowledgeCloneRebuildWorker } from '../knowledge-core/workers/knowledge-clone-rebuild.worker';
import { Specialist31RegulationsWorker } from '../knowledge-core/workers/specialist-3-1-regulations.worker';
import { ProcessDetectorWorker } from '../knowledge-core/workers/process-detector.worker';
import { ProcessTemplateCompletenessCron } from '../knowledge-core/workers/process-template-completeness.cron';
import { Specialist32KnowledgeCloneWorker } from '../knowledge-core/workers/specialist-3-2-knowledge-clone.worker';
import { Specialist33DecisionsWorker } from '../knowledge-core/workers/specialist-3-3-decisions.worker';
import { Specialist34ProjectCustomerWorker } from '../knowledge-core/workers/specialist-3-4-project-customer.worker';
import { Specialist35InsightsWorker } from '../knowledge-core/workers/specialist-3-5-insights.worker';
import { InsightClustererCron } from '../knowledge-core/workers/insight-clusterer.cron';
import { Specialist36IdeasWorker } from '../knowledge-core/workers/specialist-3-6-ideas.worker';
import { IdeaClustererCron } from '../knowledge-core/workers/idea-clusterer.cron';
import { Specialist37SkillWorker } from '../knowledge-core/workers/specialist-3-7-skill.worker';
import { SkillProfileRebuildWorker } from '../knowledge-core/workers/skill-profile-rebuild.worker';
import { SkillProfileRecalibrateCron } from '../knowledge-core/workers/skill-profile-recalibrate.cron';
import { ExecutablePersonaBuildCron } from '../knowledge-core/workers/executable-persona-build.cron';
import { ExperimentDetectorWorker } from '../knowledge-core/workers/experiment-detector.worker';
import { ExperimentStatusResolverCron } from '../knowledge-core/workers/experiment-status-resolver.cron';
import { ExperimentTransitionsCron } from '../knowledge-core/workers/experiment-transitions.cron';
import { SkillManagerDigestCron } from '../knowledge-core/workers/skill-manager-digest.cron';
import { SkillTraitConceptNormalizerCron } from '../knowledge-core/workers/skill-trait-concept-normalizer.cron';
import { StrategicAlignmentCron } from '../knowledge-core/workers/strategic-alignment.cron';
import { StrategicAlignmentWorker } from '../knowledge-core/workers/strategic-alignment.worker';
import { ThemeClustererCron } from '../knowledge-core/workers/theme-clusterer.cron';
// SBA β-8 — PersonalRelationBuilderWorker.
import { PersonalRelationBuilderWorker } from '../operations/workers/personal-relation-builder.worker';

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
  ],
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
    MeetingAnalyzeV2Worker,
    MeetingAnalyzeV2Cron,
    // ТЗ 2026-05-25 — meeting-report-fast.
    // Consumer `core.meeting-report-fast`: один LLM-вызов по СЫРОМУ
    // транскрипту → chapters + tasks + summaryFast + qualityScore.
    // На Фазе 2 producer не подключён (будет в Фазе 4) — воркер существует
    // и слушает очередь, но автоматически jobs не появляются.
    MeetingReportFastWorker,
    // ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined.
    // Consumer `core.specialists-combined`. Под flag-rollout
    // `SPECIALISTS_COMBINED_ENABLED` (default false) работает ПАРАЛЛЕЛЬНО со
    // старыми специалистами 3-1..3-9. Producer — `MeetingAnalyzeV2Cron` при
    // включённом флаге.
    SpecialistsCombinedWorker,
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
  ],
})
export class WorkersModule {}
