import { Global, Module } from '@nestjs/common';

import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookSigningService } from './webhook-signing.service';

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
