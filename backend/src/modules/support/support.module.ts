import { Module } from '@nestjs/common';

import { MessagingModule } from '../messaging/messaging.module';
import { TrackerModule } from '../tracker/tracker.module';

import { SupportAdminController } from './controllers/support-admin.controller';
import { SupportClientController } from './controllers/support-client.controller';
import { SupportDeskController } from './controllers/support-desk.controller';
import { SupportCuratorCron } from './crons/support-curator.cron';
import { SupportSlaCron } from './crons/support-sla.cron';
import { SupportAccessGuard } from './guards/support-access.guard';
import { SupportAdminGuard } from './guards/support-admin.guard';
import { SupportAccessService } from './services/support-access.service';
import { SupportAnswerCriticService } from './services/support-answer-critic.service';
import { SupportCloneService } from './services/support-clone.service';
import { SupportContourService } from './services/support-contour.service';
import { SupportCuratorService } from './services/support-curator.service';
import { SupportDeskService } from './services/support-desk.service';
import { SupportEditClassifyService } from './services/support-edit-classify.service';
import { SupportIntakeService } from './services/support-intake.service';
import { SupportLearningService } from './services/support-learning.service';
import { SupportSlaService } from './services/support-sla.service';

@Module({
  imports: [TrackerModule, MessagingModule],
  controllers: [SupportClientController, SupportDeskController, SupportAdminController],
  providers: [
    SupportAccessService,
    SupportAccessGuard,
    SupportAdminGuard,
    SupportContourService,
    SupportIntakeService,
    SupportDeskService,
    SupportSlaService,
    SupportSlaCron,
    SupportAnswerCriticService,
    SupportCloneService,
    SupportEditClassifyService,
    SupportLearningService,
    SupportCuratorService,
    SupportCuratorCron,
  ],
  exports: [SupportAccessService],
})
export class SupportModule {}
