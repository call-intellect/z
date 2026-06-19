import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';
import { IntegrationSyncLogService } from '../integrations-observability/integration-sync-log.service';

import { BitrixSyncService } from './bitrix-sync.service';
import { BITRIX_SYNC_QUEUE, type BitrixSyncJobData } from './queue/bitrix-sync.queue';

@Injectable()
export class BitrixSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitrixSyncWorker.name);
  private worker: Worker<BitrixSyncJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BitrixSyncService) private readonly syncService: BitrixSyncService,
    @Optional()
    @Inject(IntegrationSyncLogService)
    private readonly syncLog?: IntegrationSyncLogService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BitrixSyncJobData>(
      BITRIX_SYNC_QUEUE,
      async (job) => this.process(job),
      { connection: this.redis.client, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        { jobId: job?.id, scope: job?.data?.scope, err: err.message, stack: err.stack },
        'BitrixSyncWorker: job failed',
      );
    });
    this.logger.log(`BitrixSyncWorker запущен (${BITRIX_SYNC_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  async process(job: Job<BitrixSyncJobData>): Promise<void> {
    const { tenantId, scope, since } = job.data;
    this.logger.log(
      `BitrixSync старт: tenant=${tenantId} scope=${scope} since=${since ?? '-'} job=${job.id}`,
    );
    const run =
      (await this.syncLog?.begin({
        tenantId,
        provider: 'bitrix',
        kind: 'sync',
        scope,
        refId: job.id != null ? String(job.id) : null,
      })) ?? null;
    try {
      const result = await this.syncService.syncByScope(tenantId, scope, since);
      await this.syncLog?.succeed(run, result);
      this.logger.log(
        `BitrixSync готово: tenant=${tenantId} scope=${scope} ${JSON.stringify(result)}`,
      );
    } catch (err) {
      await this.syncLog?.fail(run, err);
      throw err;
    }
  }
}
