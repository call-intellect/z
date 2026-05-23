import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { MyProactiveNotificationsController } from './controllers/my-proactive-notifications.controller';
import { ProactiveDedupService } from './services/proactive-dedup.service';
import { ProactiveMessageCraftService } from './services/proactive-message-craft.service';
import { ProactiveNotificationsService } from './services/proactive-notifications.service';
import { ProactiveWatcherService } from './services/proactive-watcher.service';
import { ProactiveWatcherCron } from './workers/proactive-watcher.cron';

/**
 * SBA δ-2 — ProactiveModule.
 *
 * Содержит:
 *   - REST: `/api/v1/me/proactive-notifications`.
 *   - ProactiveWatcherService — 8 правил-инициаторов.
 *   - ProactiveDedupService — Redis SETNX anti-spam (1 per user per day).
 *   - ProactiveMessageCraftService — LLM `proactive-message-craft` + fallback.
 *   - ProactiveNotificationsService — REST CRUD (list/dismiss).
 *   - ProactiveWatcherCron — `@Cron('0 *‎/6 * * *')`.
 *
 * Зависимости:
 *   - PrismaModule (Global)
 *   - RedisModule (Global) — ProactiveDedupService
 *   - ConversationalModule (Global) — sendNotification
 *   - AiModule (LlmRouterService) — для ProactiveMessageCraftService
 *   - MetricsModule (Global) — BusinessMetricsService
 *   - ScheduleModule.forRoot() — для @Cron (поднимается в AppModule)
 *   - RbacModule (Global) — TenantGuard
 *
 * Должен подключаться ПОСЛЕ ConversationalModule и AiModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [MyProactiveNotificationsController],
  providers: [
    ProactiveDedupService,
    ProactiveMessageCraftService,
    ProactiveNotificationsService,
    ProactiveWatcherService,
    ProactiveWatcherCron,
  ],
  exports: [
    ProactiveWatcherService,
    ProactiveNotificationsService,
    ProactiveDedupService,
  ],
})
export class ProactiveModule {}
