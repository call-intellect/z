import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

import { BitrixIngestService } from './bitrix-ingest.service';
import {
  BITRIX_ANALYZE_QUEUE,
  type BitrixAnalyzeJobData,
} from './queue/bitrix-analyze.queue';

/**
 * Worker очереди `bitrix.analyze` (ТЗ 2026-06-17-bitrix24-source-sync, Ф4).
 *
 * Один job → анализ одной закрытой сессии-суток IM-диалога:
 *   1. `analysisStatus='analyzing'`.
 *   2. Посуточный rollup (BitrixIngestService.generateDayRollup) — ОДИН LLM-вызов:
 *      `накопительное + сообщения дня → { daySummary, rollingSummary }`. Сам
 *      персистит `summary` сессии и `rollingSummary` диалога. Best-effort — null
 *      (пустая сессия / ошибка LLM) НЕ роняет мост.
 *   3. Мост в knowledge-core (BitrixIngestService.ingestSession). Если null
 *      (сессия ещё открыта / отсутствует) — оставляем `pending`, вернёмся позже
 *      (sweeper-cron).
 *   4. при успехе моста → `analysisStatus='done'`, `analyzedAt`, `rawEventId`.
 *   5. при ошибке → `analysisStatus='failed'` + rethrow (BullMQ retry по attempts).
 *
 * Регистрируется в WorkersModule (in-process, как BitrixSyncWorker).
 */
@Injectable()
export class BitrixAnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitrixAnalyzeWorker.name);
  private worker: Worker<BitrixAnalyzeJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BitrixIngestService) private readonly ingest: BitrixIngestService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BitrixAnalyzeJobData>(
      BITRIX_ANALYZE_QUEUE,
      async (job) => this.process(job),
      { connection: this.redis.client, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err.message },
        'BitrixAnalyzeWorker: job failed',
      );
    });
    this.logger.log(`BitrixAnalyzeWorker запущен (${BITRIX_ANALYZE_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для тестирования. */
  async process(job: Job<BitrixAnalyzeJobData>): Promise<void> {
    const { tenantId, sessionId } = job.data;
    this.logger.debug(
      `BitrixAnalyze старт: tenant=${tenantId} session=${sessionId} job=${job.id}`,
    );

    try {
      // 1. «В анализе» (tenant-scoped updateMany).
      await this.prisma.bitrixDialogSession.updateMany({
        where: { id: sessionId, tenantId },
        data: { analysisStatus: 'analyzing' },
      });

      // 2. Посуточный rollup (персистит summary дня + rollingSummary диалога).
      await this.ingest.generateDayRollup(tenantId, sessionId);

      // 3. Мост в knowledge-core. null → сессия ещё открыта/нет → оставляем pending.
      const res = await this.ingest.ingestSession(tenantId, sessionId);
      if (res === null) {
        this.logger.debug(
          `BitrixAnalyze: session=${sessionId} ещё открыта/нет — остаётся pending`,
        );
        return;
      }

      // 4. Успех.
      await this.prisma.bitrixDialogSession.updateMany({
        where: { id: sessionId, tenantId },
        data: {
          analysisStatus: 'done',
          analyzedAt: new Date(),
          rawEventId: res.rawEventId,
        },
      });
      this.logger.debug(
        `BitrixAnalyze готово: session=${sessionId} rawEventId=${res.rawEventId}`,
      );
    } catch (err) {
      // 5. failed (best-effort) + rethrow для retry BullMQ.
      await this.prisma.bitrixDialogSession
        .updateMany({
          where: { id: sessionId, tenantId },
          data: { analysisStatus: 'failed' },
        })
        .catch(() => undefined);
      this.logger.error(
        {
          tenantId,
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'BitrixAnalyze: ошибка анализа сессии',
      );
      throw err;
    }
  }
}
