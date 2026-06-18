import { Module } from '@nestjs/common';

import { BitrixAnalyzeWorker } from '../bitrix/bitrix-analyze.worker';
import { BitrixSyncWorker } from '../bitrix/bitrix-sync.worker';
import { BitrixModule } from '../bitrix/bitrix.module';
import { ChatboxAnalyzeWorker } from '../chatbox/chatbox-analyze.worker';
import { ChatboxSyncWorker } from '../chatbox/chatbox-sync.worker';
import { ChatboxModule } from '../chatbox/chatbox.module';
import { CurationModule } from '../curation/curation.module';
import { DashboardModule } from '../dashboard/dashboard.module';
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
import { GoalEmbedWorker } from '../knowledge-core/workers/goal-embed.worker';
import { GoalTaskLinkerCron } from '../knowledge-core/workers/goal-task-linker.cron';
import { GoalThemeLinkerCron } from '../knowledge-core/workers/goal-theme-linker.cron';
import { GraphMaterializationVerifyCron } from '../knowledge-core/workers/graph-materialization-verify.cron';
import { IdeaClustererCron } from '../knowledge-core/workers/idea-clusterer.cron';
import { InsightClustererCron } from '../knowledge-core/workers/insight-clusterer.cron';
import { KnowledgeCloneRebuildCron } from '../knowledge-core/workers/knowledge-clone-rebuild.cron';
import { KnowledgeCloneRebuildWorker } from '../knowledge-core/workers/knowledge-clone-rebuild.worker';
import { MeetingReportFastWorker } from '../knowledge-core/workers/meeting-report-fast.worker';
import { PersonaLayerValidationCron } from '../knowledge-core/workers/persona-layer-validation.cron';
import { ProcessDetectorWorker } from '../knowledge-core/workers/process-detector.worker';
import { ProcessTemplateCompletenessCron } from '../knowledge-core/workers/process-template-completeness.cron';
import { ReframingCron } from '../knowledge-core/workers/reframing.cron';
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
import { MeetingUploadIngestWorker } from '../meeting-uploads/workers/meeting-upload-ingest.worker';
import { MeetingUploadTranscribeWorker } from '../meeting-uploads/workers/meeting-upload-transcribe.worker';
import { PersonalRelationBuilderWorker } from '../operations/workers/personal-relation-builder.worker';
import { ProcessesModule } from '../processes/processes.module';
import { FaststartWorker } from '../recordings/workers/faststart.worker';
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

@Module({
  imports: [
    CurationModule,
    ProcessesModule,
    TrackerModule,
    DashboardModule,
    TablesModule,
    RoleMapModule,
    ChatboxModule,
    BitrixModule,
    DocumentsModule,
  ],
  providers: [
    VoxService,
    LlmFallbackService,
    AnthropicService,
    DeepSeekService,
    MinimaxService,
    OpenAiProxyService,

    TranscribeWorker,
    MergeWorker,
    AnalyzeWorker,
    NotifyWorker,
    TranscriptIndexWorker,
    ClipRenderWorker,
    CardRollupWorker,
    BehaviorMetricsWorker,
    MeetingSpeakerAnalyzerWorker,
    TranscriptCleanWorker,
    CustomReportWorker,
    FaststartWorker,
    MeetingUploadIngestWorker,
    MeetingUploadTranscribeWorker,

    BlockIngestWorker,
    BlockDistillWorker,
    EntityResolverWorker,
    EntityResolverCronService,
    BlockLinkerWorker,
    EntityGraphBuilderCron,
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
    GoalTaskLinkerCron,
    ReframingCron,
    ThemeClustererCron,
    CardRollupV2Worker,
    Specialist34ProjectCustomerWorker,
    Specialist31RegulationsWorker,
    ProcessDetectorWorker,
    ProcessTemplateCompletenessCron,
    Specialist32KnowledgeCloneWorker,
    KnowledgeCloneRebuildWorker,
    KnowledgeCloneRebuildCron,
    RolePrincipleSynthesisCron,
    PersonaLayerValidationCron,
    Specialist33DecisionsWorker,
    Specialist35InsightsWorker,
    InsightClustererCron,
    ExperimentDetectorWorker,
    ExperimentStatusResolverCron,
    ExperimentTransitionsCron,
    Specialist36IdeasWorker,
    Specialist314GoalsWorker,
    // Ф5 (TZ 2026-06-16 task-dedup) — consumer `core.goal-embed`. Считает
    // pgvector-embedding цели (name+description) для семантического дедупа
    // целей (specialist-3-14 KNN по Goal.embedding вместо ILIKE). Зеркало
    // IssueEmbedWorker; EmbeddingFallbackService — из @Global EmbeddingsModule.
    GoalEmbedWorker,
    // SBA β-5 — cron `30 *‎/4 * * *`: кластеризация Idea → IdeaCluster
    // (KNN + LLM idea-cluster-merge на критической массе).
    IdeaClustererCron,
    Specialist37SkillWorker,
    SkillProfileRebuildWorker,
    SkillProfileRecalibrateCron,
    SkillTraitVerifyCron,
    SkillTraitConceptNormalizerCron,
    ExecutablePersonaBuildCron,
    SkillManagerDigestCron,
    MeetingReportFastWorker,
    SpecialistsCombinedWorker,
    SpecialistRoutingDispatcherWorker,
    StrategicAlignmentWorker,
    StrategicAlignmentCron,

    PersonalRelationBuilderWorker,

    DocumentIngestAdapter,
    TextIngestAdapter,
    DocumentImportWorker,

    SprintHelperWorker,
    SprintHelperCron,

    TableSyncWorker,
    TableEnrichWorker,

    ChatboxSyncWorker,
    BitrixSyncWorker,
    BitrixAnalyzeWorker,
    ChatboxAnalyzeWorker,
  ],
})
export class WorkersModule {}
