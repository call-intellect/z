import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

import { CHAT_INGEST_QUEUE, type ChatIngestJobData, chatIngestJobId } from './chat-ingest.queue';

@Injectable()
export class ChatIngestQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatIngestQueueService.name);
  private queue: Queue<ChatIngestJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ChatIngestJobData>(CHAT_INGEST_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
      },
    });
    this.logger.log(`ChatIngestQueueService: очередь ${CHAT_INGEST_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async enqueue(messageId: string): Promise<void> {
    const q = this.requireQueue();
    await q.add('ingest', { messageId }, { jobId: chatIngestJobId(messageId) });
  }

  private requireQueue(): Queue<ChatIngestJobData> {
    if (!this.queue) {
      throw new Error('ChatIngestQueueService: enqueue до onModuleInit');
    }
    return this.queue;
  }
}
