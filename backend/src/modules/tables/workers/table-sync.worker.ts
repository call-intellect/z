import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { TABLES_QUEUE_NAMES, type TableSyncJobData } from '../queues';
import { TableSyncService } from '../services/table-sync.service';

/**
 * Worker очереди `tables.sync` (Smart-tables Фаза 2 — graph-driven rows).
 *
 * Регистрируется in-process в `WorkersModule` (как AnalyzeWorker и пр.). На
 * каждый job вызывает соответствующий метод `TableSyncService`:
 *   - `entity-event`   → applyEntityEvent (created/updated/archived);
 *   - `backfill-batch` → runBackfillBatch (один батч initial-backfill).
 *
 * Concurrency=3: операции идемпотентны (upsert по (tableId, entityId)),
 * параллелизм безопасен; разные Entity не конфликтуют, а повтор того же
 * события — no-op.
 */
@Injectable()
export class TableSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TableSyncWorker.name);
  private worker: Worker<TableSyncJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TableSyncService) private readonly sync: TableSyncService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<TableSyncJobData>(
      TABLES_QUEUE_NAMES.SYNC,
      async (job) =>
        this.pipe.job(SystemLogPipeline.INTEGRATIONS, 'tables.sync', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 3,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobId: job?.id ?? null,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-sync: job упал',
      );
    });
    this.logger.log(`TableSyncWorker запущен (${TABLES_QUEUE_NAMES.SYNC})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<TableSyncJobData>): Promise<void> {
    const data = job.data;
    if (data.kind === 'entity-event') {
      await this.sync.applyEntityEvent({
        tenantId: data.tenantId,
        entityId: data.entityId,
        entityType: data.entityType,
        eventType: data.eventType,
      });
      return;
    }
    if (data.kind === 'backfill-batch') {
      await this.sync.runBackfillBatch({
        tenantId: data.tenantId,
        tableId: data.tableId,
        entityIds: data.entityIds,
      });
      return;
    }
  }
}
