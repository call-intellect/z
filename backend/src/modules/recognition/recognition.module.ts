import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { BadgesController } from './controllers/badges.controller';
import { CommentsThanksController } from './controllers/comments-thanks.controller';
import { ContributionsController } from './controllers/contributions.controller';
import { RecognitionAdminController } from './controllers/recognition-admin.controller';
import { TeamSpotlightController } from './controllers/team-spotlight.controller';
import { BadgeAwarderCron } from './cron/badge-awarder.cron';
import { ContributionSnapshotCron } from './cron/contribution-snapshot.cron';
import { RecognitionWeeklyDigestCron } from './cron/recognition-weekly-digest.cron';
import { StreakDetectorCron } from './cron/streak-detector.cron';
import { BadgeConditionsService } from './services/badge-conditions.service';
import { CommentsThanksService } from './services/comments-thanks.service';
import { RecognitionPreferenceService } from './services/recognition-preference.service';
import { RecognitionService } from './services/recognition.service';
import { TeamSpotlightService } from './services/team-spotlight.service';
import { RecognitionFormulateWorker } from './workers/recognition-formulate.worker';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [
    ContributionsController,
    BadgesController,
    CommentsThanksController,
    RecognitionAdminController,
    TeamSpotlightController,
  ],
  providers: [
    RecognitionService,
    CommentsThanksService,
    BadgeConditionsService,
    TeamSpotlightService,
    RecognitionPreferenceService,
    RecognitionFormulateWorker,
    ContributionSnapshotCron,
    BadgeAwarderCron,
    RecognitionWeeklyDigestCron,
    StreakDetectorCron,
  ],
  exports: [
    RecognitionService,
    CommentsThanksService,
    BadgeConditionsService,
    TeamSpotlightService,
    RecognitionPreferenceService,
  ],
})
export class RecognitionModule {}
