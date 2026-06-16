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
  TABLE_SYNC_JOB_OPTIONS,
  TABLES_QUEUE_NAMES,
  type TableSyncBackfillBatchJobData,
  type TableSyncEntityJobData,
  type TableSyncJobData,
} from '../queues';

@Injectable()
export class TableSyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TableSyncQueueService.name);
  private queue: Queue<TableSyncJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<TableSyncJobData>(TABLES_QUEUE_NAMES.SYNC, {
      connection: this.redis.client,
      defaultJobOptions: TABLE_SYNC_JOB_OPTIONS,
    });
    this.logger.log(`TableSyncQueueService инициализирован (${TABLES_QUEUE_NAMES.SYNC})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${TABLES_QUEUE_NAMES.SYNC}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      this.queue = null;
    }
  }

  async enqueueEntityEvent(data: Omit<TableSyncEntityJobData, 'kind'>): Promise<void> {
    const q = this.queue;
    if (!q) {
      throw new Error('TableSyncQueueService: enqueue до onModuleInit');
    }
    const jobId = `tsync:${data.eventType}:${data.entityId}`;
    await q.add('entity-event', { kind: 'entity-event', ...data }, { jobId });
    this.logger.debug(
      `enqueue tables.sync entity-event type=${data.eventType} entity=${data.entityId}`,
    );
  }

  async enqueueBackfillBatch(data: Omit<TableSyncBackfillBatchJobData, 'kind'>): Promise<void> {
    const q = this.queue;
    if (!q) {
      throw new Error('TableSyncQueueService: enqueue до onModuleInit');
    }
    const first = data.entityIds[0] ?? 'empty';
    const jobId = `tbackfill_${data.tableId}_${first}_${data.entityIds.length}`;
    await q.add('backfill-batch', { kind: 'backfill-batch', ...data }, { jobId });
    this.logger.debug(
      `enqueue tables.sync backfill-batch table=${data.tableId} size=${data.entityIds.length}`,
    );
  }
}
