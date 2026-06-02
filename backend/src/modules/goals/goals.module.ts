import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { GoalKrProgressCron } from './cron/goal-kr-progress.cron';
import { StrategicAlignmentCron } from './cron/strategic-alignment.cron';
import { GoalsController } from './goals.controller';
import { GoalKeyResultsService } from './services/goal-key-results.service';
import { GoalKrProgressService } from './services/goal-kr-progress.service';
import { GoalsService } from './services/goals.service';
import { StrategicAlignmentIssuesService } from './services/strategic-alignment-issues.service';

/**
 * GoalsModule (Фаза 9 knowledge-core + Sprint 3 B1-3.2).
 *
 * REST API целей компании + сервис CRUD/тем + issue-based strategic
 * alignment (Sprint 3 B1-3.2).
 *
 * LLM-based strategic-alignment воркер (`strategic-alignment.{cron,worker}`
 * в `knowledge-core/workers/`) живёт в `WorkersModule` и читает таблицу
 * `Goal` напрямую через PrismaService — он считает движение к цели
 * тематически. Issue-based cron здесь (`cron/strategic-alignment.cron.ts`)
 * — второй сигнал, по задачам трекера; они не дублируют друг друга.
 *
 * Зависимости (через @Global):
 *   - PrismaModule, AuthModule, RbacModule, AuditModule, RedisModule.
 *   - CoreQueueModule (через global) — для `/recompute` enqueue.
 *   - ProbeModule (через global) — для probe-trigger strategic_misalignment_high.
 */
@Module({
  imports: [PrismaModule],
  controllers: [GoalsController],
  providers: [
    GoalsService,
    GoalKeyResultsService,
    GoalKrProgressService,
    StrategicAlignmentIssuesService,
    StrategicAlignmentCron,
    GoalKrProgressCron,
  ],
  exports: [
    GoalsService,
    GoalKeyResultsService,
    GoalKrProgressService,
    StrategicAlignmentIssuesService,
  ],
})
export class GoalsModule {}
