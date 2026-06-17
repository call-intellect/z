import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { AdminPromptEvolutionController } from './controllers/admin-prompt-evolution.controller';
import { AutoRuleExtractorService } from './services/autorule-extractor.service';
import { GepaRunnerService } from './services/gepa-runner.service';
import { PromptFeedbackCollectorService } from './services/prompt-feedback-collector.service';
import { RuleInjectorService } from './services/rule-injector.service';
import { AutoRuleExtractCron } from './workers/autorule-extract.cron';
import { GepaAbMonitorCron } from './workers/gepa-ab-monitor.cron';
import { GepaOptimizeCron } from './workers/gepa-optimize.cron';
import { GepaPromoteCron } from './workers/gepa-promote.cron';

@Module({
  imports: [PrismaModule],
  controllers: [AdminPromptEvolutionController],
  providers: [
    PromptFeedbackCollectorService,
    AutoRuleExtractorService,
    RuleInjectorService,
    AutoRuleExtractCron,
    GepaRunnerService,
    GepaOptimizeCron,
    GepaPromoteCron,
    GepaAbMonitorCron,
  ],
  exports: [RuleInjectorService, GepaRunnerService],
})
export class PromptEvolutionModule {}
