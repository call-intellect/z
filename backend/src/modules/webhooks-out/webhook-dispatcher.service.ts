import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { ulid } from 'ulid';

import { RedisService } from '../../common/redis/redis.service';

import { SubscriptionsRepository } from './subscriptions.repository';
import {
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_JOB_OPTIONS,
  type WebhookDeliveryJobData,
} from './webhook-queue';

@Injectable()
export class WebhookDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private queue: Queue<WebhookDeliveryJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SubscriptionsRepository) private readonly repo: SubscriptionsRepository,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue<WebhookDeliveryJobData>(WEBHOOK_DELIVERY_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: WEBHOOK_JOB_OPTIONS,
    });
    this.logger.log(`WebhookDispatcher: очередь ${WEBHOOK_DELIVERY_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async dispatch(args: {
    event: string;
    userId: string;
    payload: Record<string, unknown>;
  }): Promise<{ enqueued: number }> {
    const subs = await this.repo.findByUserAndEvent(args.userId, args.event);
    if (subs.length === 0) return { enqueued: 0 };
    const queue = this.requireQueue();

    let enqueued = 0;
    for (const sub of subs) {
      const eventId = ulid();
      const wrappedPayload = {
        type: args.event,
        eventId,
        userId: args.userId,
        sentAt: new Date().toISOString(),
        data: args.payload,
      };
      const delivery = await this.repo.createDelivery({
        subscriptionId: sub.id,
        event: args.event,
        eventId,
        payload: wrappedPayload,
      });
      await queue.add('deliver', { deliveryId: delivery.id }, { jobId: `delivery_${delivery.id}` });
      enqueued += 1;
    }
    this.logger.debug(
      `dispatch: event=${args.event} user=${args.userId} subs=${subs.length} enqueued=${enqueued}`,
    );
    return { enqueued };
  }

  async dispatchOne(args: {
    subscriptionId: string;
    event: string;
    payload: Record<string, unknown>;
  }): Promise<{ deliveryId: string }> {
    const queue = this.requireQueue();
    const eventId = ulid();
    const wrappedPayload = {
      type: args.event,
      eventId,
      sentAt: new Date().toISOString(),
      data: args.payload,
      test: true,
    };
    const delivery = await this.repo.createDelivery({
      subscriptionId: args.subscriptionId,
      event: args.event,
      eventId,
      payload: wrappedPayload,
    });
    await queue.add('deliver', { deliveryId: delivery.id }, { jobId: `delivery:${delivery.id}` });
    return { deliveryId: delivery.id };
  }

  async enqueueRetry(deliveryId: string, delayMs: number): Promise<void> {
    const queue = this.requireQueue();
    await queue.add(
      'deliver',
      { deliveryId },
      {
        jobId: `delivery_${deliveryId}_retry_${Date.now()}`,
        delay: delayMs,
      },
    );
  }

  private requireQueue(): Queue<WebhookDeliveryJobData> {
    if (!this.queue) {
      throw new Error('WebhookDispatcher: queue не инициализирован');
    }
    return this.queue;
  }
}
