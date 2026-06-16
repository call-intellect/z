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
  BITRIX_ANALYZE_JOB_OPTIONS,
  BITRIX_ANALYZE_QUEUE,
  type BitrixAnalyzeJobData,
} from './bitrix-analyze.queue';

/**
 * Producer очереди `bitrix.analyze` (ТЗ 2026-06-17-bitrix24-source-sync, Ф4).
 * По образцу `ChatboxAnalyzeQueueService`.
 *
 * `enqueue(tenantId, sessionId)` ставит job анализа закрытой сессии-суток.
 * Дедуп по jobId `bitrix-analyze-${sessionId}` (BullMQ не добавит второй job с
 * тем же id, пока первый не завершён/не очищен). Разделитель `-`, НЕ `:`
 * (BullMQ 5.x запрещает `:` в custom jobId).
 *
 * Worker (`bitrix-analyze.worker.ts`) подхватывает и зовёт BitrixIngestService
 * (день-саммари + накопительное + мост в knowledge-core).
 */
@Injectable()
export class BitrixAnalyzeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitrixAnalyzeQueueService.name);
  private queue: Queue<BitrixAnalyzeJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<BitrixAnalyzeJobData>(BITRIX_ANALYZE_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: BITRIX_ANALYZE_JOB_OPTIONS,
    });
    this.logger.log(`BitrixAnalyzeQueue: очередь ${BITRIX_ANALYZE_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  /** Поставить job анализа. Дедуп по jobId `bitrix-analyze-${sessionId}`. */
  async enqueue(
    tenantId: string,
    sessionId: string,
  ): Promise<{ jobId: string }> {
    const queue = this.requireQueue();
    const jobId = `bitrix-analyze-${sessionId}`;
    await queue.add('analyze', { tenantId, sessionId }, { jobId });
    this.logger.debug(
      `enqueue: tenant=${tenantId} session=${sessionId} jobId=${jobId}`,
    );
    return { jobId };
  }

  private requireQueue(): Queue<BitrixAnalyzeJobData> {
    if (!this.queue) {
      throw new Error('BitrixAnalyzeQueue: queue не инициализирован');
    }
    return this.queue;
  }
}
