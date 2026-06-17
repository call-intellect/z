import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { GoalKrProgressCron } from './cron/goal-kr-progress.cron';
import { GoalsPulseCron } from './cron/goals-pulse.cron';
import { StrategicAlignmentCron } from './cron/strategic-alignment.cron';
import { GoalsController } from './goals.controller';
import { GoalKeyResultsService } from './services/goal-key-results.service';
import { GoalKrProgressService } from './services/goal-kr-progress.service';
import { GoalsPulseService } from './services/goals-pulse.service';
import { GoalsService } from './services/goals.service';
import { StrategicAlignmentIssuesService } from './services/strategic-alignment-issues.service';

@Module({
  imports: [PrismaModule],
  controllers: [GoalsController],
  providers: [
    GoalsService,
    GoalKeyResultsService,
    GoalKrProgressService,
    GoalsPulseService,
    StrategicAlignmentIssuesService,
    StrategicAlignmentCron,
    GoalKrProgressCron,
    GoalsPulseCron,
  ],
  exports: [
    GoalsService,
    GoalKeyResultsService,
    GoalKrProgressService,
    GoalsPulseService,
    StrategicAlignmentIssuesService,
  ],
})
export class GoalsModule {}
