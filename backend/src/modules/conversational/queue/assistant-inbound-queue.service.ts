import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import type { InboundMessage } from '../types/channel.types';

import {
  ASSISTANT_INBOUND_QUEUE,
  type AssistantInboundJobData,
} from './assistant-inbound-queue';

/**
 * Тонкая обёртка над BullMQ-очередью `assistant.inbound` (Ф1 calendar-master,
 * 2026-06-18). Используется webhook-контроллерами Telegram/MAX для раннего ACK:
 * webhook ставит готовый `InboundMessage` в очередь и сразу отвечает 200, а
 * тяжёлый concierge tool-loop отрабатывает фоновый воркер `AssistantInboundWorker`.
 *
 * Дедуп — два слоя:
 *   1. Идемпотентный ключ в Redis (`tg:update:*` / `max:update:*`) в контроллере.
 *   2. `jobId = assistant_inbound_<dedupeId>` — BullMQ не создаст дубль job'а в
 *      окне дедупа (страховка, если ретрай проскочил мимо Redis-ключа).
 *
 * `attempts: 1` — BullMQ-ретраи выключены намеренно: повторный прогон job'а
 * означал бы повторную обработку (дубль ответа), а это ровно тот баг, который
 * чинит Ф1.
 */
@Injectable()
export class AssistantInboundQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AssistantInboundQueueService.name);
  private queue: Queue<AssistantInboundJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<AssistantInboundJobData>(ASSISTANT_INBOUND_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: {
        // attempts:1 — НЕ хотим BullMQ-ретраев: повтор = дубль обработки.
        attempts: 1,
        removeOnComplete: { age: 3600, count: 1_000 },
        removeOnFail: { age: 24 * 3600, count: 1_000 },
      },
    });
    this.logger.log(
      `AssistantInboundQueueService: очередь ${ASSISTANT_INBOUND_QUEUE} готова`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  /**
   * Постановка inbound в очередь раннего ACK.
   *
   * `dedupeId` (если задан) → `jobId = assistant_inbound_<dedupeId>`: второй
   * слой защиты от дублей (jobId-дедуп BullMQ). Без `dedupeId` — без jobId
   * (например, когда update_id/mid отсутствуют).
   */
  async enqueue(args: {
    inbound: InboundMessage;
    dedupeId?: string;
  }): Promise<void> {
    const q = this.requireQueue();
    const jobId = args.dedupeId
      ? `assistant_inbound_${args.dedupeId}`
      : undefined;
    await q.add('inbound', { inbound: args.inbound }, { jobId });
    this.logger.debug(
      `enqueue assistant.inbound type=${args.inbound.type} jobId=${jobId ?? '(none)'}`,
    );
  }

  private requireQueue(): Queue<AssistantInboundJobData> {
    if (!this.queue) {
      throw new Error(
        'AssistantInboundQueueService: попытка enqueue до onModuleInit',
      );
    }
    return this.queue;
  }
}
