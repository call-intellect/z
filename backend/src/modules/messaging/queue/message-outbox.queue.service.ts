import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

import { MESSAGE_OUTBOX_QUEUE, type MessageOutboxJobData, outboxJobId } from './message-outbox.queue';

@Injectable()
export class MessageOutboxQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageOutboxQueueService.name);
  private queue: Queue<MessageOutboxJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<MessageOutboxJobData>(MESSAGE_OUTBOX_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
      },
    });
    this.logger.log(`MessageOutboxQueueService: очередь ${MESSAGE_OUTBOX_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async enqueue(messageId: string): Promise<void> {
    const q = this.requireQueue();
    await q.add('relay', { messageId }, { jobId: outboxJobId(messageId) });
  }

  private requireQueue(): Queue<MessageOutboxJobData> {
    if (!this.queue) {
      throw new Error('MessageOutboxQueueService: enqueue до onModuleInit');
    }
    return this.queue;
  }
}
