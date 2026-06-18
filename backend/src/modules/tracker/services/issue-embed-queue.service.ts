import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { ISSUE_EMBED_JOB_OPTIONS, type IssueEmbedJobData, TRACKER_QUEUE_NAMES } from '../queues';

@Injectable()
export class IssueEmbedQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IssueEmbedQueueService.name);
  private queue: Queue<IssueEmbedJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<IssueEmbedJobData>(TRACKER_QUEUE_NAMES.ISSUE_EMBED, {
      connection: this.redis.client,
      defaultJobOptions: ISSUE_EMBED_JOB_OPTIONS,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  async enqueue(args: {
    tenantId: string;
    issueId: string;
    embeddingHash?: string | null;
  }): Promise<void> {
    if (!this.queue) {
      this.logger.warn('IssueEmbedQueueService: queue не инициализирована');
      return;
    }
    const jobId = `issue-embed:${args.issueId}:${args.embeddingHash ?? 'init'}`;
    await this.queue.add(
      'issue-embed',
      { tenantId: args.tenantId, issueId: args.issueId },
      { jobId },
    );
  }
}
