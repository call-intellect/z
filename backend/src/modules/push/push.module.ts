import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { PushSubscriptionsController } from './controllers/push-subscriptions.controller';
import { PushCleanupCron } from './cron/push-cleanup.cron';
import { PushSubscriptionsService } from './services/push-subscriptions.service';
import { WebPushSender } from './services/web-push-sender.service';
import { PushSenderWorker } from './workers/push-sender.worker';

/**
 * PushModule (Wave 2 backend-web-push, 2026-05-24).
 *
 * Глобальный модуль (@Global), чтобы другие модули (ActivityFeedService,
 * RecognitionService, ConversationalService) могли инжектить
 * `WebPushSender.sendToUser` или эмитить `core.push-send` через CoreQueueService
 * без повторных imports.
 *
 * Состав:
 *   - REST: POST/DELETE/GET `/api/v1/me/push-subscriptions`.
 *   - Worker: consumer `core.push-send` (concurrency 5).
 *   - Cron: ежесуточная очистка протухших подписок (03:00 UTC).
 *
 * Зависимости (все @Global):
 *   - PrismaService, RedisService — common.
 *   - TypedConfigService — common/config.
 *   - CookieAuthGuard + AuthModule — auth/.
 *   - TenantGuard — rbac/.
 *   - CoreQueueService — core-queue/ (для других модулей, которые будут
 *     эмитить push). PushModule сам очередь не публикует — только потребляет.
 *
 * Регистрировать в AppModule ПОСЛЕ AuthModule, RbacModule, CoreQueueModule.
 *
 * ENV:
 *   - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (optional) — отправка push'ей.
 *     Если хотя бы один отсутствует — WebPushSender уходит в no-op (warn),
 *     persistence (создание подписок) продолжает работать.
 *   - VAPID_SUBJECT (default `mailto:noreply@kora.app`).
 *   - PUSH_MAX_FAILURES (default 5) — порог удаления подписки.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PushSubscriptionsController],
  providers: [
    PushSubscriptionsService,
    WebPushSender,
    PushSenderWorker,
    PushCleanupCron,
  ],
  exports: [PushSubscriptionsService, WebPushSender],
})
export class PushModule {}
