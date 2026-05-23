import { Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';

import { CrossFunctionalController } from './cross-functional.controller';
import { ProcessesController } from './processes.controller';
import { CrossFunctionalDetectorService } from './services/cross-functional-detector.service';
import { CrossFunctionalFrictionService } from './services/cross-functional-friction.service';
import { DecisionPointService } from './services/decision-point.service';
import { ProcessExtractionService } from './services/process-extraction.service';
import { ProcessHandoffService } from './services/process-handoff.service';
import { ProcessTemplateCompletenessService } from './services/process-template-completeness.service';
import { ProcessTemplateProbeService } from './services/process-template-probe.service';
import { ProcessTemplateService } from './services/process-template.service';
import { CrossFunctionalFrictionAggregatorCron } from './workers/cross-functional-friction-aggregator.cron';

/**
 * SBA α-7 wave 2 — ProcessesModule.
 *
 * REST API `/api/v1/processes/*` (templates, decision-points, handoffs,
 * extract). Содержит 4 сервиса (CRUD/version/extract/completeness) + probe
 * для триггеров.
 *
 * SBA γ-3 — расширение CrossFunctional (детектор + friction-aggregator cron +
 * REST `/api/v1/processes/cross-functional/*`).
 *
 * RBAC через `process_template` ResourceType (см. policy.csv). LlmRouterService
 * и BusinessMetricsService берутся из @Global модулей (AiModule + MetricsModule).
 * CoreQueueService — для async-trigger extract'а.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    // ConversationalService, ProbeService, LlmRouterService, CoreQueueService,
    // BusinessMetricsService — все через @Global модули (ничего импортировать
    // не нужно).
  ],
  controllers: [ProcessesController, CrossFunctionalController],
  providers: [
    ProcessTemplateService,
    DecisionPointService,
    ProcessHandoffService,
    ProcessExtractionService,
    ProcessTemplateCompletenessService,
    ProcessTemplateProbeService,
    // SBA γ-3 — Cross-Functional Process detector + friction tracker + daily cron.
    CrossFunctionalDetectorService,
    CrossFunctionalFrictionService,
    CrossFunctionalFrictionAggregatorCron,
  ],
  exports: [
    ProcessTemplateService,
    DecisionPointService,
    ProcessHandoffService,
    ProcessExtractionService,
    ProcessTemplateCompletenessService,
    ProcessTemplateProbeService,
    CrossFunctionalDetectorService,
    CrossFunctionalFrictionService,
  ],
})
export class ProcessesModule {}
