import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { BadgesController } from './controllers/badges.controller';
import { CommentsThanksController } from './controllers/comments-thanks.controller';
import { ContributionsController } from './controllers/contributions.controller';
import { RecognitionAdminController } from './controllers/recognition-admin.controller';
import { BadgeAwarderCron } from './cron/badge-awarder.cron';
import { ContributionSnapshotCron } from './cron/contribution-snapshot.cron';
import { RecognitionWeeklyDigestCron } from './cron/recognition-weekly-digest.cron';
import { StreakDetectorCron } from './cron/streak-detector.cron';
import { BadgeConditionsService } from './services/badge-conditions.service';
import { CommentsThanksService } from './services/comments-thanks.service';
import { RecognitionService } from './services/recognition.service';
import { RecognitionFormulateWorker } from './workers/recognition-formulate.worker';

/**
 * Wave 2 — Recognition + Gamification.
 *
 * Глобальный модуль (@Global), чтобы другие модули могли инжектить
 * `RecognitionService.enqueueFormulate(...)` без повторных imports (например,
 * Specialist 3.6 — при `idea.status='shipped'`, или Specialist 3.8 —
 * при создании HelpfulnessSpotlight).
 *
 * Зависимости (все @Global):
 *   - PrismaService, RedisService — common.
 *   - LlmRouterService — из AiModule (@Global).
 *   - CoreQueueService — из CoreQueueModule (@Global).
 *   - RbacService — из RbacModule (@Global).
 *
 * Cron'ы:
 *   - ContributionSnapshotCron        @Cron('0 4 * * *')   — daily 04:00 UTC
 *   - BadgeAwarderCron                @Cron('0 5 * * *')   — daily 05:00 UTC (после snapshot)
 *   - RecognitionWeeklyDigestCron     @Cron('0 9 * * 1')   — monday 09:00 UTC
 *   - StreakDetectorCron              @Cron('0 23 * * *')  — daily 23:00 UTC
 *
 * Worker:
 *   - RecognitionFormulateWorker — consumer `core.recognition-formulate`.
 *
 * Регистрировать в AppModule ПОСЛЕ AiModule, CoreQueueModule, RbacModule.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [
    ContributionsController,
    BadgesController,
    CommentsThanksController,
    RecognitionAdminController,
  ],
  providers: [
    RecognitionService,
    CommentsThanksService,
    BadgeConditionsService,
    RecognitionFormulateWorker,
    ContributionSnapshotCron,
    BadgeAwarderCron,
    RecognitionWeeklyDigestCron,
    StreakDetectorCron,
  ],
  exports: [RecognitionService, CommentsThanksService, BadgeConditionsService],
})
export class RecognitionModule {}
