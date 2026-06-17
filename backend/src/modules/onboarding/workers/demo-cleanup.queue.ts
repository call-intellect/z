import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

export const DEMO_CLEANUP_QUEUE_NAME = 'onboarding.demo-cleanup' as const;

export interface DemoCleanupJobData {
  orgId: string;
  actorUserId: string;
}

const DEMO_CLEANUP_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: false,
};

@Injectable()
export class DemoCleanupQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoCleanupQueue.name);
  private queue: Queue<DemoCleanupJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<DemoCleanupJobData>(DEMO_CLEANUP_QUEUE_NAME, {
      connection: this.redis.client,
      defaultJobOptions: DEMO_CLEANUP_DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`DemoCleanupQueue инициализирован (${DEMO_CLEANUP_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.close();
    } catch (err) {
      this.logger.warn(
        `Ошибка при закрытии очереди ${DEMO_CLEANUP_QUEUE_NAME}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      this.queue = null;
    }
  }

  get raw(): Queue<DemoCleanupJobData> {
    if (!this.queue) {
      throw new Error('DemoCleanupQueue: используется до onModuleInit (queue=null)');
    }
    return this.queue;
  }

  async enqueue(data: DemoCleanupJobData): Promise<{ jobId: string }> {
    const jobId = `demo-cleanup_${data.orgId}`;
    await this.raw.add('cleanup', data, { jobId });
    this.logger.debug({ jobId, orgId: data.orgId }, 'demo-cleanup: enqueue');
    return { jobId };
  }
}
