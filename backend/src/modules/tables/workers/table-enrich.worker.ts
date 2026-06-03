import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../../common/config/index';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { TABLES_QUEUE_NAMES, type TableEnrichJobData } from '../queues';
import { TableEnrichService } from '../services/table-enrich.service';

/** Дефолт throttle (code-fallback; источник правды — AdminSetting). */
const DEFAULT_MAX_CONCURRENT_PER_ORG = 100;
/** TTL счётчика in-flight на случай зависшего job'а (защита от утечки). */
const INFLIGHT_TTL_SEC = 1800;

/**
 * Worker очереди `tables.enrich` (Smart-tables Фаза 3 — Event-to-Cells).
 *
 * Регистрируется in-process в `WorkersModule` (как TableSyncWorker). На каждый
 * job:
 *   1. Throttle per-Org: Redis incr `table:enrich:jobs:<tenantId>`; если выше
 *      лимита — decr + skip (job завершается; повторный enrich придёт со
 *      следующей встречей, либо ретраем по backoff).
 *   2. Вызывает `TableEnrichService.enrichFromEvent`.
 *   3. В finally — decr счётчика.
 *
 * Concurrency=4: enrich идемпотентен (кэш по TableCellProvenance), разные
 * встречи не конфликтуют.
 */
@Injectable()
export class TableEnrichWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TableEnrichWorker.name);
  private worker: Worker<TableEnrichJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TableEnrichService) private readonly enrich: TableEnrichService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<TableEnrichJobData>(
      TABLES_QUEUE_NAMES.ENRICH,
      async (job) =>
        this.pipe.job(SystemLogPipeline.INTEGRATIONS, 'tables.enrich', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobId: job?.id ?? null,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-enrich: job упал',
      );
    });
    this.logger.log(`TableEnrichWorker запущен (${TABLES_QUEUE_NAMES.ENRICH})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<TableEnrichJobData>): Promise<void> {
    const { meetingId, tenantId } = job.data;
    if (!meetingId || !tenantId) return;

    const max = await this.getMaxConcurrent();
    const counterKey = `table:enrich:jobs:${tenantId}`;
    let acquired = false;
    try {
      const inFlight = await this.redis.client.incr(counterKey);
      acquired = true;
      // expire ставим только когда счётчик «свежий» (=1) — защита от утечки.
      if (inFlight === 1) {
        await this.redis.client.expire(counterKey, INFLIGHT_TTL_SEC);
      }
      if (inFlight > max) {
        this.logger.debug(
          { tenantId, inFlight, max },
          'table-enrich: throttle — пропускаем (over per-org limit)',
        );
        return;
      }
      await this.enrich.enrichFromEvent({ meetingId, tenantId });
    } finally {
      if (acquired) {
        await this.redis.client.decr(counterKey).catch(() => undefined);
      }
    }
  }

  private async getMaxConcurrent(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'table.agent.max_concurrent_enrich_jobs_per_org',
      undefined,
      DEFAULT_MAX_CONCURRENT_PER_ORG,
    );
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? v
      : DEFAULT_MAX_CONCURRENT_PER_ORG;
  }
}
