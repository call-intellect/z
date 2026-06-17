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

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [ProcessesController, CrossFunctionalController],
  providers: [
    ProcessTemplateService,
    DecisionPointService,
    ProcessHandoffService,
    ProcessExtractionService,
    ProcessTemplateCompletenessService,
    ProcessTemplateProbeService,
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
