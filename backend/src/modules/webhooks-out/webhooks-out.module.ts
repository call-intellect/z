import { Global, Module } from '@nestjs/common';

import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookSigningService } from './webhook-signing.service';

/**
 * Глобальный модуль outgoing webhooks.
 *
 * Экспортирует:
 *   - `WebhookDispatcherService` — для инжекта в продуктовые модули
 *      (meetings/tasks/highlights/shares/exports → `dispatch({ event, ... })`).
 *   - `WebhookSigningService` — на случай ручной подписи.
 *
 * Worker (`WebhookDeliveryWorker`) запускается в HTTP-процессе. Это
 * сознательный выбор: исходящие webhooks — лёгкая I/O нагрузка, отдельный
 * worker-процесс пока не нужен. Если объём вырастет — переедет в `WorkersModule`.
 */
@Global()
@Module({
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionsRepository,
    WebhookDispatcherService,
    WebhookDeliveryWorker,
    WebhookSigningService,
  ],
  exports: [
    SubscriptionsService,
    SubscriptionsRepository,
    WebhookDispatcherService,
    WebhookSigningService,
  ],
})
export class WebhooksOutModule {}
