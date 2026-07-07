import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { S3Service } from '../recordings/s3.service';
import { TablesModule } from '../tables/tables.module';
import { TrackerModule } from '../tracker/tracker.module';

import { SearchService } from './api/search.service';
import { AxisClassifierService } from './services/axis-classifier.service';
import { BlockAccessDeriverService } from './services/block-access-deriver.service';
import { BlockExtractionService } from './services/block-extraction.service';
import { BlockFetchService, KnowledgeBlockResolver } from './services/block-fetch.service';
import { BlockLinkService } from './services/block-link.service';
import { BlockMergeService } from './services/block-merge.service';
import { BranchDerivationService } from './services/branch-derivation.service';
import { CardRollupV2Service } from './services/card-rollup-v2.service';
import { ChatV2RetrievalService } from './services/chat-v2-retrieval.service';
import { ChatV2TableContextService } from './services/chat-v2-table-context.service';
import { ChatV2Service } from './services/chat-v2.service';
import { ChunkContextService } from './services/chunk-context.service';
import { ClusteringService } from './services/clustering.service';
import { ConfidenceCalibrationService } from './services/confidence-calibration.service';
import { DataClassPolicyService } from './services/dataclass-policy.service';
import { KnowledgeEmbeddingService } from './services/embedding.service';
import { EntityGraphService } from './services/entity-graph.service';
import { EntityLinkService } from './services/entity-link.service';
import { EntityMergeService } from './services/entity-merge.service';
import { EntityResolutionService } from './services/entity-resolution.service';
import { ExecutablePersonaBuildService } from './services/executable-persona-build.service';
import { ExecutablePersonaVersioningService } from './services/executable-persona-versioning.service';
import { FactSupersedeService } from './services/fact-supersede.service';
import { GoalTaskLinkerService } from './services/goal-task-linker.service';
import { GoalThemeLinkerService } from './services/goal-theme-linker.service';
import { GoalsCheckpointProbeHandler } from './services/goals-checkpoint-probe.handler';
import { GraphMaterializationService } from './services/graph-materialization.service';
import { MeetingSkeletonService } from './services/meeting-skeleton.service';
import { MeetingTitleService } from './services/meeting-title.service';
import { OwnerResolverService } from './services/owner-resolver.service';
import { PersonaLayerValidationService } from './services/persona-layer-validation.service';
import { PreferenceDatasetService } from './services/preference-dataset.service';
import { ProjectionRebuilderService } from './services/projection-rebuilder.service';
import { ProvenanceService } from './services/provenance.service';
import { ReasoningChainService } from './services/reasoning-chain.service';
import { RegulationConsolidatorService } from './services/regulation-consolidator.service';
import { RoleClonePersonaVersioningHandler } from './services/role-clone-persona-versioning.handler';
import { RolePrincipleSynthesisService } from './services/role-principle-synthesis.service';
import { RegulationSummaryService } from './services/regulation-summary.service';
import { RoleRegulationRetrievalService } from './services/role-regulation-retrieval.service';
import { RouterService } from './services/router.service';
import { SegmentBuilderService } from './services/segment-builder.service';
import { SkillTraitConceptService } from './services/skill-trait-concept.service';
import { Specialist31ProbeService } from './services/specialist-3-1-probe.service';
import { Specialist31Service } from './services/specialist-3-1-regulations.service';
import { Specialist314GoalsService } from './services/specialist-3-14-goals.service';
import { Specialist32Service } from './services/specialist-3-2-knowledge-clone.service';
import { Specialist32ProbeService } from './services/specialist-3-2-probe.service';
import { Specialist33Service } from './services/specialist-3-3-decisions.service';
import { Specialist34ProbeService } from './services/specialist-3-4-probe.service';
import { Specialist35Service } from './services/specialist-3-5-insights.service';
import { Specialist36Service } from './services/specialist-3-6-ideas.service';
import { Specialist36ProbeService } from './services/specialist-3-6-probe.service';
import { Specialist37ProbeService } from './services/specialist-3-7-skill-probe.service';
import { Specialist37Service } from './services/specialist-3-7-skill.service';
import { Specialist39ExperimentProbeService } from './services/specialist-3-9-experiment-probe.service';
import { Specialist39ExperimentsService } from './services/specialist-3-9-experiments.service';
import { SpecialistsCombinedService } from './services/specialists-combined.service';
import { StructuredDocumentCompilerService } from './services/structured-document-compiler.service';
import { SprintHelperService } from './services/sprint-helper.service';
import { SprintReviewService } from './services/sprint-review.service';
import { TaskAssigneeResolverService } from './services/task-assignee-resolver.service';
import { TaskSolutionBuildService } from './services/task-solution-build.service';
import { TemporalConflictService } from './services/temporal-conflict.service';
import { TemporalProbeService } from './services/temporal-probe.service';
import { ThemeClassificationService } from './services/theme-classification.service';
import { ThemeFillService } from './services/theme-fill.service';
import { ThemeWriteService } from './services/theme-write.service';
import { ConfidenceCalibrationCron } from './workers/confidence-calibration.cron';
import { CoreMetricsSnapshotCron } from './workers/core-metrics-snapshot.cron';
import { DataClassAuditSnapshotCron } from './workers/dataclass-audit-snapshot.cron';
import { ExecutablePersonaTriggerWatcherCron } from './workers/executable-persona-trigger-watcher.cron';
import { SignalTypeStatsCron } from './workers/signal-type-stats.cron';
import { TemporalProbeCron } from './workers/temporal-probe.cron';
import { VoiceNoteAudioRetentionCron } from './workers/voice-note-audio-retention.cron';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule, CurationModule, TablesModule, TrackerModule, DashboardModule],
  providers: [
    RoleClonePersonaVersioningHandler,
    S3Service,
    SegmentBuilderService,
    BlockExtractionService,
    MeetingSkeletonService,
    KnowledgeEmbeddingService,
    ChunkContextService,
    RoleRegulationRetrievalService,
    RegulationSummaryService,
    EntityResolutionService,
    RegulationConsolidatorService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    EntityGraphService,
    SearchService,
    ClusteringService,
    ThemeClassificationService,
    CardRollupV2Service,
    BlockFetchService,
    KnowledgeBlockResolver,
    TaskAssigneeResolverService,
    ChatV2RetrievalService,
    ChatV2Service,
    ChatV2TableContextService,
    CoreMetricsSnapshotCron,
    RouterService,
    AxisClassifierService,
    BlockAccessDeriverService,
    BranchDerivationService,
    OwnerResolverService,
    Specialist34ProbeService,
    Specialist31Service,
    Specialist31ProbeService,
    StructuredDocumentCompilerService,
    Specialist32Service,
    Specialist32ProbeService,
    Specialist33Service,
    Specialist35Service,
    Specialist39ExperimentsService,
    Specialist39ExperimentProbeService,
    Specialist36Service,
    Specialist36ProbeService,
    Specialist314GoalsService,
    GoalsCheckpointProbeHandler,
    Specialist37Service,
    Specialist37ProbeService,
    ExecutablePersonaBuildService,
    ExecutablePersonaVersioningService,
    ExecutablePersonaTriggerWatcherCron,
    SkillTraitConceptService,
    RolePrincipleSynthesisService,
    PersonaLayerValidationService,
    DataClassPolicyService,
    FactSupersedeService,
    ConfidenceCalibrationService,
    PreferenceDatasetService,
    TemporalProbeService,
    ConfidenceCalibrationCron,
    TemporalProbeCron,
    VoiceNoteAudioRetentionCron,
    SignalTypeStatsCron,
    DataClassAuditSnapshotCron,
    EntityLinkService,
    ReasoningChainService,
    ProjectionRebuilderService,
    ProvenanceService,
    SpecialistsCombinedService,
    SprintHelperService,
    SprintReviewService,
    TemporalConflictService,
    GraphMaterializationService,
    GoalThemeLinkerService,
    GoalTaskLinkerService,
    MeetingTitleService,
    ThemeWriteService,
    ThemeFillService,
    TaskSolutionBuildService,
  ],
  exports: [
    SegmentBuilderService,
    BlockExtractionService,
    MeetingSkeletonService,
    KnowledgeEmbeddingService,
    ChunkContextService,
    RoleRegulationRetrievalService,
    RegulationSummaryService,
    EntityResolutionService,
    RegulationConsolidatorService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    EntityGraphService,
    SearchService,
    ClusteringService,
    ThemeClassificationService,
    CardRollupV2Service,
    BlockFetchService,
    KnowledgeBlockResolver,
    TaskAssigneeResolverService,
    ChatV2RetrievalService,
    ChatV2Service,
    ChatV2TableContextService,
    RouterService,
    AxisClassifierService,
    BlockAccessDeriverService,
    BranchDerivationService,
    OwnerResolverService,
    Specialist34ProbeService,
    Specialist31Service,
    Specialist31ProbeService,
    StructuredDocumentCompilerService,
    Specialist32Service,
    Specialist32ProbeService,
    Specialist33Service,
    Specialist35Service,
    Specialist39ExperimentsService,
    Specialist39ExperimentProbeService,
    Specialist36Service,
    Specialist36ProbeService,
    Specialist314GoalsService,
    Specialist37Service,
    Specialist37ProbeService,
    ExecutablePersonaBuildService,
    ExecutablePersonaVersioningService,
    RoleClonePersonaVersioningHandler,
    SkillTraitConceptService,
    RolePrincipleSynthesisService,
    PersonaLayerValidationService,
    DataClassPolicyService,
    FactSupersedeService,
    ConfidenceCalibrationService,
    PreferenceDatasetService,
    TemporalProbeService,
    EntityLinkService,
    ReasoningChainService,
    ProjectionRebuilderService,
    ProvenanceService,
    SpecialistsCombinedService,
    SprintHelperService,
    SprintReviewService,
    TemporalConflictService,
    GraphMaterializationService,
    GoalThemeLinkerService,
    GoalTaskLinkerService,
    MeetingTitleService,
    ThemeWriteService,
    ThemeFillService,
    TaskSolutionBuildService,
  ],
})
export class KnowledgeCoreModule {}
