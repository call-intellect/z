/**
 * FeedbackModule — канал «Ваши предложения» с AI-кластеризацией.
 *
 * Содержит:
 *   - FeedbackUserController  (POST/GET /api/v1/feedback)
 *   - FeedbackAdminController (CRUD /api/v1/admin/feedback)
 *   - FeedbackService         (submit + history + limit + admin facades)
 *   - FeedbackDigestService   (ночной AI-прогон + ручной enqueue)
 *   - FeedbackTopicManagerService (rename / merge / archive / списки)
 *   - FeedbackRateLimitGuard  (5 сообщений в сутки на userId, окно UTC)
 *   - FeedbackDigestQueue     (BullMQ-очередь core.feedback-digest)
 *   - FeedbackDigestWorker    (consumer очереди — зовёт runDigest)
 *   - FeedbackDigestCron      (`0 1 * * *` UTC, продюсер cron-job'а)
 *
 * Зависимости через @Global модули:
 *   - PrismaService / RedisService — auto-imported (оба @Global).
 *   - LlmRouterService             — из @Global AiModule.
 *
 * AuthModule импортирован для CookieAuthGuard + SuperAdminGuard
 * (по аналогии с QualityScoreModule).
 *
 * BullMQ-инфраструктура (queue/worker/cron) живёт внутри модуля и стартует
 * в `onModuleInit` — отдельного worker-процесса в Z нет (см. AiWorkersModule).
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

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
    // BullMQ-инфраструктура ночного прогона.
    FeedbackDigestQueue,
    FeedbackDigestWorker,
    FeedbackDigestCron,
  ],
  exports: [FeedbackService, FeedbackDigestService, FeedbackTopicManagerService],
})
export class FeedbackModule {}
