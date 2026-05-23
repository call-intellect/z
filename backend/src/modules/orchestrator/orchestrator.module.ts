import { Module } from '@nestjs/common';

import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module';

import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './services/orchestrator.service';
import { OrchestratorSubagentQueue } from './services/orchestrator-subagent.queue';
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

/**
 * SBA δ-1 — OrchestratorModule.
 *
 * Multi-agent deep research для сложных запросов («составь отчёт по X»,
 * «сравни Y и Z»). 4 шага: plan → spawn subagents → synthesize → verify.
 *
 * Hard limits (anti-cost-runaway):
 *   - depth=1 hard limit (subagent НЕ может spawn'ить);
 *   - max 5 subagents per run (clamp);
 *   - 15-min run timeout;
 *   - feature-flag ORCHESTRATOR_ENABLED default false.
 *
 * Очередь `orchestrator.subagents` живёт ВНУТРИ модуля (не часть CoreQueueService).
 * Worker `OrchestratorSubagentWorker` — отдельный consumer, concurrency=3.
 * Cron `org-knowledge-index-builder` — daily 03:00.
 *
 * REST API: `/api/v1/orchestrator/*` (SSE + JSON polling + cancel).
 * RBAC: ResourceType='orchestrator' (write для employee, manage для admin).
 *
 * Зависит от:
 *   - @Global PrismaModule / RedisModule / GraphModule / MetricsModule / RbacModule / AuthModule;
 *   - @Global AiModule (LlmRouterService);
 *   - KnowledgeCoreModule (ChatV2RetrievalService — для subagent retrieval).
 */
@Module({
  imports: [KnowledgeCoreModule],
  controllers: [OrchestratorController],
  providers: [
    // core services
    OrchestratorService,
    PlanningService,
    SubagentSpawnerService,
    SynthesisService,
    VerificationService,
    OrgKnowledgeIndexService,

    // queue + worker
    OrchestratorSubagentQueue,
    OrchestratorSubagentWorker,

    // cron
    OrgKnowledgeIndexBuilderCron,

    // strategies (4 готовых)
    EntityResearchStrategy,
    ComparisonStrategy,
    TopicSummaryStrategy,
    TimelineConstructionStrategy,
  ],
  exports: [OrchestratorService, OrgKnowledgeIndexService],
})
export class OrchestratorModule {}
