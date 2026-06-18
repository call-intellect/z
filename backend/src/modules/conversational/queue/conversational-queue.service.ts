import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

import { CONVERSATIONAL_SEND_QUEUE, type ConversationalSendJobData } from './conversational-queue';

@Injectable()
export class ConversationalQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationalQueueService.name);
  private queue: Queue<ConversationalSendJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ConversationalSendJobData>(CONVERSATIONAL_SEND_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
      },
    });
    this.logger.log(`ConversationalQueueService: очередь ${CONVERSATIONAL_SEND_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async enqueueSend(args: {
    deliveryId: string;
    attempt?: number;
    delayMs?: number;
  }): Promise<void> {
    const q = this.requireQueue();
    const attempt = args.attempt ?? 0;
    const jobId =
      attempt === 0
        ? `delivery_${args.deliveryId}`
        : `delivery_${args.deliveryId}_attempt${attempt}`;
    await q.add('send', { deliveryId: args.deliveryId, attempt }, { jobId, delay: args.delayMs });
    this.logger.debug(
      `enqueueSend deliveryId=${args.deliveryId} attempt=${attempt} delay=${args.delayMs ?? 0}ms jobId=${jobId}`,
    );
  }

  private requireQueue(): Queue<ConversationalSendJobData> {
    if (!this.queue) {
      throw new Error('ConversationalQueueService: попытка enqueue до onModuleInit');
    }
    return this.queue;
  }
}
