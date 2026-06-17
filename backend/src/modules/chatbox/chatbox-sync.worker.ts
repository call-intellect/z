import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { RedisService } from '../../common/redis/redis.service';

import { ChatboxSyncService } from './chatbox-sync.service';
import { CHATBOX_SYNC_QUEUE, type ChatboxSyncJobData } from './queue/chatbox-sync.queue';

@Injectable()
export class ChatboxSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxSyncWorker.name);
  private worker: Worker<ChatboxSyncJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ChatboxSyncService)
    private readonly syncService: ChatboxSyncService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ChatboxSyncJobData>(
      CHATBOX_SYNC_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn({ jobId: job?.id, err: err.message }, 'ChatboxSyncWorker: job failed');
    });
    this.logger.log(`ChatboxSyncWorker запущен (${CHATBOX_SYNC_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  async process(job: Job<ChatboxSyncJobData>): Promise<void> {
    const { tenantId, scope, since } = job.data;
    this.logger.debug(
      `ChatboxSync старт: tenant=${tenantId} scope=${scope} since=${since ?? '-'} job=${job.id}`,
    );
    try {
      let result: Record<string, number> | void;
      if (scope === 'incremental') {
        result = await this.syncService.incrementalSync(tenantId);
      } else {
        result = await this.syncService.syncByScope(tenantId, scope, {
          since: since ? new Date(since) : undefined,
        });
      }
      this.metrics?.incChatboxSync({ scope, status: 'success' });
      this.metrics?.setChatboxLastSyncTs({
        scope,
        tsSeconds: Math.floor(Date.now() / 1000),
      });
      this.logger.debug(
        `ChatboxSync готово: tenant=${tenantId} scope=${scope} ${JSON.stringify(result)}`,
      );
    } catch (err) {
      this.metrics?.incChatboxSync({ scope, status: 'failed' });
      throw err;
    }
  }
}
