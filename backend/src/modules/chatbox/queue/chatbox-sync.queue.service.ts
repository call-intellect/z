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
  CHATBOX_SYNC_JOB_OPTIONS,
  CHATBOX_SYNC_QUEUE,
  type ChatboxSyncJobData,
  type ChatboxSyncScope,
} from './chatbox-sync.queue';

/**
 * Producer очереди `chatbox.sync` (ТЗ 2026-06-05, Фаза 3).
 *
 * `enqueue(tenantId, scope)` ставит job синка. `jobId = chatbox:${tenantId}:${scope}`
 * даёт дедупликацию параллельных одинаковых синков (BullMQ не добавит второй job
 * с тем же jobId, пока первый не завершён/не очищен).
 *
 * Worker (`chatbox-sync.worker.ts`) подхватывает и вызывает ChatboxSyncService.
 */
@Injectable()
export class ChatboxSyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxSyncQueueService.name);
  private queue: Queue<ChatboxSyncJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ChatboxSyncJobData>(CHATBOX_SYNC_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: CHATBOX_SYNC_JOB_OPTIONS,
    });
    this.logger.log(`ChatboxSyncQueue: очередь ${CHATBOX_SYNC_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  /** Поставить job синка. Дедуп по jobId `chatbox:${tenantId}:${scope}`. */
  async enqueue(
    tenantId: string,
    scope: ChatboxSyncScope,
  ): Promise<{ jobId: string }> {
    const queue = this.requireQueue();
    const jobId = `chatbox:${tenantId}:${scope}`;
    await queue.add('sync', { tenantId, scope }, { jobId });
    this.logger.debug(`enqueue: tenant=${tenantId} scope=${scope} jobId=${jobId}`);
    return { jobId };
  }

  private requireQueue(): Queue<ChatboxSyncJobData> {
    if (!this.queue) {
      throw new Error('ChatboxSyncQueue: queue не инициализирован');
    }
    return this.queue;
  }
}
