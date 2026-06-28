import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { ChatIngestService } from '../services/chat-ingest.service';

import { CHAT_INGEST_QUEUE, type ChatIngestJobData } from './chat-ingest.queue';

@Injectable()
export class ChatIngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatIngestWorker.name);
  private worker: Worker<ChatIngestJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ChatIngestService) private readonly chatIngest: ChatIngestService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ChatIngestJobData>(
      CHAT_INGEST_QUEUE,
      async (job) => this.chatIngest.ingestMessage(job.data.messageId),
      { connection: this.redis.client, concurrency: 4 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, messageId: job?.data.messageId, err: err.message },
        'ChatIngestWorker: job failed',
      );
    });
    this.logger.log('ChatIngestWorker запущен');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }
}
