import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type DataClass } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { DataClassPolicyService } from '../../knowledge-core/services/dataclass-policy.service';
import {
  TRACKER_QUEUE_NAMES,
  WEBHOOK_DELIVERY_JOB_OPTIONS,
  type WebhookDeliveryJobData,
} from '../queues';

@Injectable()
export class WebhookDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private queue: Queue<WebhookDeliveryJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly policy?: DataClassPolicyService,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue<WebhookDeliveryJobData>(TRACKER_QUEUE_NAMES.WEBHOOK_DELIVERY, {
      connection: this.redis.client,
    });
    this.logger.log(
      `WebhookDispatcher: очередь ${TRACKER_QUEUE_NAMES.WEBHOOK_DELIVERY} инициализирована`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  async dispatch(
    tenantId: string,
    eventType: string,
    payload: Record<string, unknown>,
    payloadDataClass: DataClass = 'internal',
  ): Promise<string[]> {
    if (!this.queue) {
      this.logger.warn(
        { tenantId, eventType },
        'WebhookDispatcher.dispatch вызван до onModuleInit — событие пропущено',
      );
      return [];
    }
    const webhooks = await this.prisma.issueWebhook.findMany({
      where: {
        tenantId,
        isActive: true,
        events: { has: eventType },
      },
      select: { id: true, name: true, allowedDataClasses: true },
    });

    if (webhooks.length === 0) return [];

    const enqueuedAt = new Date().toISOString();
    const jobIds: string[] = [];
    let blocked = 0;
    for (const w of webhooks) {
      if (this.policy) {
        const gate = this.policy.canEmit({
          payloadDataClass,
          sink: {
            kind: 'issue_webhook',
            allowedDataClasses: w.allowedDataClasses,
            channel: `${w.id}:${w.name}`,
          },
        });
        if (!gate.allowed) {
          blocked += 1;
          this.logger.warn(
            { tenantId, eventType, webhookId: w.id, reason: gate.reason },
            'WebhookDispatcher.dispatch: webhook blocked by canEmit (W4.3)',
          );
          continue;
        }
      }
      const jobData: WebhookDeliveryJobData = {
        webhookId: w.id,
        tenantId,
        eventType,
        payload,
        enqueuedAt,
      };
      const job = await this.queue.add(eventType, jobData, {
        ...WEBHOOK_DELIVERY_JOB_OPTIONS,
      });
      if (job.id) jobIds.push(job.id);
    }
    this.logger.debug(
      {
        tenantId,
        eventType,
        count: jobIds.length,
        blocked,
        payloadDataClass,
      },
      'webhook-dispatcher: jobs enqueued',
    );
    return jobIds;
  }

  async dispatchTest(args: { webhookId: string; tenantId: string }): Promise<string | null> {
    if (!this.queue) return null;
    const jobData: WebhookDeliveryJobData = {
      webhookId: args.webhookId,
      tenantId: args.tenantId,
      eventType: 'webhook.test',
      payload: {
        event: 'webhook.test',
        tenantId: args.tenantId,
        webhookId: args.webhookId,
        message: 'Тестовая отправка из админки трекера',
        timestamp: new Date().toISOString(),
      },
      enqueuedAt: new Date().toISOString(),
    };
    const job = await this.queue.add('webhook.test', jobData, {
      attempts: 1,
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400, count: 100 },
    });
    return job.id ?? null;
  }
}
