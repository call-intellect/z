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
  CHATBOX_ANALYZE_JOB_OPTIONS,
  CHATBOX_ANALYZE_QUEUE,
  type ChatboxAnalyzeJobData,
} from './chatbox-analyze.queue';

/**
 * Producer очереди `chatbox.analyze` (ТЗ 2026-06-05, Фаза 5).
 *
 * `enqueue(tenantId, sessionId)` ставит job анализа закрытой сессии.
 * `jobId = chatbox-analyze:${sessionId}` даёт дедупликацию по сессии (BullMQ
 * не добавит второй job с тем же jobId, пока первый не завершён/не очищен).
 *
 * Worker (`chatbox-analyze.worker.ts`) подхватывает и вызывает
 * ChatboxIngestService (summary + мост в knowledge-core).
 */
@Injectable()
export class ChatboxAnalyzeQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChatboxAnalyzeQueueService.name);
  private queue: Queue<ChatboxAnalyzeJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<ChatboxAnalyzeJobData>(CHATBOX_ANALYZE_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: CHATBOX_ANALYZE_JOB_OPTIONS,
    });
    this.logger.log(
      `ChatboxAnalyzeQueue: очередь ${CHATBOX_ANALYZE_QUEUE} готова`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  /** Поставить job анализа. Дедуп по jobId `chatbox-analyze:${sessionId}`. */
  async enqueue(
    tenantId: string,
    sessionId: string,
  ): Promise<{ jobId: string }> {
    const queue = this.requireQueue();
    const jobId = `chatbox-analyze:${sessionId}`;
    await queue.add('analyze', { tenantId, sessionId }, { jobId });
    this.logger.debug(
      `enqueue: tenant=${tenantId} session=${sessionId} jobId=${jobId}`,
    );
    return { jobId };
  }

  private requireQueue(): Queue<ChatboxAnalyzeJobData> {
    if (!this.queue) {
      throw new Error('ChatboxAnalyzeQueue: queue не инициализирован');
    }
    return this.queue;
  }
}
