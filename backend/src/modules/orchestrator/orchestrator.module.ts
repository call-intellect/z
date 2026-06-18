import { Module } from '@nestjs/common';

import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module';

import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorSubagentQueue } from './services/orchestrator-subagent.queue';
import { OrchestratorService } from './services/orchestrator.service';
import { OrgKnowledgeIndexService } from './services/org-knowledge-index.service';
import { PlanningService } from './services/planning.service';
import { SubagentSpawnerService } from './services/subagent-spawner.service';
import { SynthesisService } from './services/synthesis.service';
import { VerificationService } from './services/verification.service';
import { ComparisonStrategy } from './strategies/comparison.strategy';
import { EntityResearchStrategy } from './strategies/entity-research.strategy';
import { TimelineConstructionStrategy } from './strategies/timeline-construction.strategy';
import { TopicSummaryStrategy } from './strategies/topic-summary.strategy';
import { OrchestratorSubagentWorker } from './workers/orchestrator-subagent.worker';
import { OrgKnowledgeIndexBuilderCron } from './workers/org-knowledge-index-builder.cron';

@Module({
  imports: [KnowledgeCoreModule],
  controllers: [OrchestratorController],
  providers: [
    OrchestratorService,
    PlanningService,
    SubagentSpawnerService,
    SynthesisService,
    VerificationService,
    OrgKnowledgeIndexService,

    OrchestratorSubagentQueue,
    OrchestratorSubagentWorker,

    OrgKnowledgeIndexBuilderCron,

    EntityResearchStrategy,
    ComparisonStrategy,
    TopicSummaryStrategy,
    TimelineConstructionStrategy,
  ],
  exports: [OrchestratorService, OrgKnowledgeIndexService],
})
export class OrchestratorModule {}
