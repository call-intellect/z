import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';

import { BitrixSyncService } from './bitrix-sync.service';
import { BITRIX_SYNC_QUEUE, type BitrixSyncJobData } from './queue/bitrix-sync.queue';

@Injectable()
export class BitrixSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitrixSyncWorker.name);
  private worker: Worker<BitrixSyncJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BitrixSyncService) private readonly syncService: BitrixSyncService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BitrixSyncJobData>(
      BITRIX_SYNC_QUEUE,
      async (job) => this.process(job),
      { connection: this.redis.client, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn({ jobId: job?.id, err: err.message }, 'BitrixSyncWorker: job failed');
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
    const { tenantId, scope } = job.data;
    this.logger.debug(`BitrixSync старт: tenant=${tenantId} scope=${scope} job=${job.id}`);
    const result = await this.syncService.syncByScope(tenantId, scope);
    this.logger.debug(
      `BitrixSync готово: tenant=${tenantId} scope=${scope} ${JSON.stringify(result)}`,
    );
  }
}
