/**
 * FeedbackModule — канал «Ваши предложения» с AI-кластеризацией.
 *
 * Содержит:
 *   - FeedbackUserController  (POST/GET /api/v1/feedback)
 *   - FeedbackAdminController (CRUD /api/v1/admin/feedback)
 *   - FeedbackService         (submit + history + limit)
 *   - FeedbackDigestService   (ночной AI-прогон + ручной enqueue)
 *   - FeedbackTopicManagerService (rename / merge / archive / списки)
 *   - FeedbackRateLimitGuard  (5 сообщений в сутки на userId, окно UTC)
 *
 * Зависимости через @Global модули:
 *   - PrismaService / RedisService — auto-imported (оба @Global).
 *
 * AuthModule импортирован для CookieAuthGuard + SuperAdminGuard
 * (по аналогии с QualityScoreModule).
 *
 * BullMQ-воркер `feedback-digest` и cron 01:00 UTC будут зарегистрированы
 * отдельно в WorkersModule в Фазе 5 (см. ТЗ).
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

@Module({
  imports: [AuthModule],
  controllers: [FeedbackUserController, FeedbackAdminController],
  providers: [
    FeedbackService,
    FeedbackDigestService,
    FeedbackTopicManagerService,
    FeedbackRateLimitGuard,
  ],
  exports: [FeedbackService, FeedbackDigestService, FeedbackTopicManagerService],
})
export class FeedbackModule {}
