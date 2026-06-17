import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

import {
  BITRIX_SYNC_JOB_OPTIONS,
  BITRIX_SYNC_QUEUE,
  type BitrixSyncJobData,
  type BitrixSyncScope,
} from './bitrix-sync.queue';

@Injectable()
export class BitrixSyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitrixSyncQueueService.name);
  private queue: Queue<BitrixSyncJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<BitrixSyncJobData>(BITRIX_SYNC_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: BITRIX_SYNC_JOB_OPTIONS,
    });
    this.logger.log(`BitrixSyncQueue: очередь ${BITRIX_SYNC_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async enqueue(tenantId: string, scope: BitrixSyncScope): Promise<{ jobId: string }> {
    const queue = this.requireQueue();
    const jobId = `bitrix-sync-${tenantId}-${scope}`;
    await queue.add('sync', { tenantId, scope }, { jobId });
    this.logger.debug(`enqueue: tenant=${tenantId} scope=${scope} jobId=${jobId}`);
    return { jobId };
  }

  private requireQueue(): Queue<BitrixSyncJobData> {
    if (!this.queue) {
      throw new Error('BitrixSyncQueue: queue не инициализирован');
    }
    return this.queue;
  }
}
