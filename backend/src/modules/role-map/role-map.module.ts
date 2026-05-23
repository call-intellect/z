import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CoreQueueModule } from '../core-queue/core-queue.module';

import { RoleMapController } from './role-map.controller';
import { AuthorityBoundaryService } from './services/authority-boundary.service';
import { DecisionPolicyService } from './services/decision-policy.service';
import { InteractionService } from './services/interaction.service';
import { RequiredKnowledgeService } from './services/required-knowledge.service';
import { ResponsibilityElementService } from './services/responsibility-element.service';
import { RoleMapBuilderService } from './services/role-map-builder.service';
import { RoleMapBuilderWorker } from './workers/role-map-builder.worker';
import { RoleMapCompletenessCron } from './workers/role-map-completeness.cron';

/**
 * SBA α-8 wave 4 — RoleMapModule.
 *
 * 5 CRUD-сервисов поверх wave-2 нормализованных моделей:
 *   - ResponsibilityElement (outcome/function/activity)
 *   - AuthorityBoundary (allowed/requires_approval/forbidden)
 *   - RequiredKnowledge (mandatory/preferred/nice_to_have)
 *   - DecisionPolicy
 *   - Interaction (reports_to / collaborates_with / ...)
 *
 * Высокоуровневый агрегатор `RoleMapBuilderService`:
 *   - getMap(roleId) → RoleMapDto для UI;
 *   - getMaturity(roleId) → maturity drill-down с rationale;
 *   - recomputeAllForTenant — пересчёт completeness для всех ролей Org.
 *
 * Worker'ы:
 *   - `RoleMapBuilderWorker` — consumer `core.specialist-routing`
 *     (jobName='3-8-role-map-builder'), батч 5 минут per role, идемпотентный.
 *   - `RoleMapCompletenessCron` — суточный пересчёт completeness в 04:00 UTC
 *     (на час раньше MaturityScorerCron 05:00 UTC из α-9 wave 3).
 *
 * Зависимости (через @Global): PrismaModule, RbacModule, AuthModule, AuditModule,
 * MetricsModule, RedisModule, AiModule (LlmRouterService), ScheduleModule.
 *
 * См. plans/tz/2026-05-23-sba-alpha-8-wave4-role-map-worker-rest-ui.md.
 */
@Module({
  imports: [PrismaModule, CoreQueueModule],
  controllers: [RoleMapController],
  providers: [
    ResponsibilityElementService,
    AuthorityBoundaryService,
    RequiredKnowledgeService,
    DecisionPolicyService,
    InteractionService,
    RoleMapBuilderService,
    RoleMapBuilderWorker,
    RoleMapCompletenessCron,
  ],
  exports: [
    ResponsibilityElementService,
    AuthorityBoundaryService,
    RequiredKnowledgeService,
    DecisionPolicyService,
    InteractionService,
    RoleMapBuilderService,
  ],
})
export class RoleMapModule {}
