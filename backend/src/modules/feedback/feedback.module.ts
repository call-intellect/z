import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { FeedbackAdminController } from './controllers/feedback-admin.controller';
import { FeedbackUserController } from './controllers/feedback-user.controller';
import { FeedbackRateLimitGuard } from './guards/feedback-rate-limit.guard';
import { FeedbackDigestService } from './services/feedback-digest.service';
import { FeedbackTopicManagerService } from './services/feedback-topic-manager.service';
import { FeedbackService } from './services/feedback.service';
import { FeedbackDigestCron } from './workers/feedback-digest.cron';
import { FeedbackDigestQueue } from './workers/feedback-digest.queue';
import { FeedbackDigestWorker } from './workers/feedback-digest.worker';

@Module({
  imports: [AuthModule],
  controllers: [FeedbackUserController, FeedbackAdminController],
  providers: [
    FeedbackService,
    FeedbackDigestService,
    FeedbackTopicManagerService,
    FeedbackRateLimitGuard,
    FeedbackDigestQueue,
    FeedbackDigestWorker,
    FeedbackDigestCron,
  ],
  exports: [FeedbackService, FeedbackDigestService, FeedbackTopicManagerService],
})
export class FeedbackModule {}
