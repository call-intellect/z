import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';

import { ChatboxSyncService } from './chatbox-sync.service';
import {
  CHATBOX_SYNC_QUEUE,
  type ChatboxSyncJobData,
} from './queue/chatbox-sync.queue';

/**
 * Worker очереди `chatbox.sync` (ТЗ 2026-06-05, Фаза 3).
 *
 * Один job → ChatboxSyncService:
 *   - scope='incremental' → incrementalSync(tenantId)
 *   - иначе               → syncByScope(tenantId, scope)
 *
 * Регистрируется в WorkersModule (in-process, как остальные воркеры).
 */
@Injectable()
export class ChatboxSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxSyncWorker.name);
  private worker: Worker<ChatboxSyncJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ChatboxSyncService)
    private readonly syncService: ChatboxSyncService,
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
      this.logger.warn(
        { jobId: job?.id, err: err.message },
        'ChatboxSyncWorker: job failed',
      );
    });
    this.logger.log(`ChatboxSyncWorker запущен (${CHATBOX_SYNC_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для тестирования. */
  async process(job: Job<ChatboxSyncJobData>): Promise<void> {
    const { tenantId, scope } = job.data;
    this.logger.log(
      `ChatboxSync старт: tenant=${tenantId} scope=${scope} job=${job.id}`,
    );
    let result: Record<string, number> | void;
    if (scope === 'incremental') {
      result = await this.syncService.incrementalSync(tenantId);
    } else {
      result = await this.syncService.syncByScope(tenantId, scope);
    }
    this.logger.log(
      `ChatboxSync готово: tenant=${tenantId} scope=${scope} ${JSON.stringify(result)}`,
    );
  }
}
