import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

export const FEEDBACK_DIGEST_QUEUE_NAME = 'core.feedback-digest' as const;

export interface FeedbackDigestJobData {
  triggeredBy: 'cron' | 'manual';
}

const FEEDBACK_DIGEST_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: false,
};

@Injectable()
export class FeedbackDigestQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackDigestQueue.name);
  private queue: Queue<FeedbackDigestJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<FeedbackDigestJobData>(FEEDBACK_DIGEST_QUEUE_NAME, {
      connection: this.redis.client,
      defaultJobOptions: FEEDBACK_DIGEST_DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`FeedbackDigestQueue инициализирован (${FEEDBACK_DIGEST_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.close();
    } catch (err) {
      this.logger.warn(
        `Ошибка при закрытии очереди ${FEEDBACK_DIGEST_QUEUE_NAME}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      this.queue = null;
    }
  }

  get raw(): Queue<FeedbackDigestJobData> {
    if (!this.queue) {
      throw new Error('FeedbackDigestQueue: используется до onModuleInit (queue=null)');
    }
    return this.queue;
  }

  async enqueueManualRun(): Promise<{ jobId: string }> {
    const jobId = `feedback-digest-manual-${Date.now()}`;
    await this.raw.add('run', { triggeredBy: 'manual' }, { jobId });
    this.logger.debug({ jobId }, 'feedback-digest: enqueue manual run');
    return { jobId };
  }

  async enqueueCronRun(now: Date = new Date()): Promise<{ jobId: string }> {
    const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
    const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = now.getUTCDate().toString().padStart(2, '0');
    const jobId = `feedback-digest-cron-${yyyy}${mm}${dd}`;
    await this.raw.add('run', { triggeredBy: 'cron' }, { jobId });
    this.logger.debug({ jobId }, 'feedback-digest: enqueue cron run');
    return { jobId };
  }
}
