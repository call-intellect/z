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

/**
 * HTTP/listener-side диспетчер очереди `tables.sync` (Smart-tables Фаза 2).
 *
 * Воркер (`TableSyncWorker`) живёт in-process в `WorkersModule`; здесь — только
 * enqueue. Регистрируется в `TablesModule` (доступен и listener'у, и
 * `TableSyncService.runInitialBackfill`).
 */
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

  /**
   * Поставить реакцию на событие графа. jobId
   * `tsync:<eventType>:<entityId>` — повторный enqueue того же события в
   * течение жизни job'а в Redis игнорируется (idempotency).
   */
  async enqueueEntityEvent(data: Omit<TableSyncEntityJobData, 'kind'>): Promise<void> {
    const q = this.queue;
    if (!q) {
      throw new Error('TableSyncQueueService: enqueue до onModuleInit');
    }
    const jobId = `tsync:${data.eventType}:${data.entityId}`;
    await q.add(
      'entity-event',
      { kind: 'entity-event', ...data },
      { jobId },
    );
    this.logger.debug(
      `enqueue tables.sync entity-event type=${data.eventType} entity=${data.entityId}`,
    );
  }

  /**
   * Поставить фоновый батч initial-backfill (для больших Org). jobId
   * `tbackfill:<tableId>:<firstEntityId>` — детерминирован по содержимому
   * батча, чтобы повторный enqueue того же батча не дублировался.
   */
  async enqueueBackfillBatch(
    data: Omit<TableSyncBackfillBatchJobData, 'kind'>,
  ): Promise<void> {
    const q = this.queue;
    if (!q) {
      throw new Error('TableSyncQueueService: enqueue до onModuleInit');
    }
    const first = data.entityIds[0] ?? 'empty';
    const jobId = `tbackfill:${data.tableId}:${first}:${data.entityIds.length}`;
    await q.add(
      'backfill-batch',
      { kind: 'backfill-batch', ...data },
      { jobId },
    );
    this.logger.debug(
      `enqueue tables.sync backfill-batch table=${data.tableId} size=${data.entityIds.length}`,
    );
  }
}
