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

import { ChatboxIngestService } from './chatbox-ingest.service';
import {
  CHATBOX_ANALYZE_QUEUE,
  type ChatboxAnalyzeJobData,
} from './queue/chatbox-analyze.queue';

/**
 * Worker очереди `chatbox.analyze` (ТЗ 2026-06-05, Фаза 5).
 *
 * Один job → анализ одной закрытой сессии чата:
 *   1. `analysisStatus='analyzing'`.
 *   2. best-effort LLM-summary (ChatboxIngestService.generateSummary) →
 *      persist в `summary` (если не null).
 *   3. мост в knowledge-core (ChatboxIngestService.ingestSession). Если null
 *      (сессия ещё открыта / отсутствует) — оставляем `pending`, вернёмся позже.
 *   4. при успехе моста → `analysisStatus='done'`, `analyzedAt`, `rawEventId`.
 *   5. при ошибке → `analysisStatus='failed'` + rethrow (BullMQ сделает retry
 *      по attempts из CHATBOX_ANALYZE_JOB_OPTIONS).
 *
 * Регистрируется в WorkersModule (in-process, как остальные воркеры).
 */
@Injectable()
export class ChatboxAnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxAnalyzeWorker.name);
  private worker: Worker<ChatboxAnalyzeJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxIngestService)
    private readonly ingest: ChatboxIngestService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ChatboxAnalyzeJobData>(
      CHATBOX_ANALYZE_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err.message },
        'ChatboxAnalyzeWorker: job failed',
      );
    });
    this.logger.log(`ChatboxAnalyzeWorker запущен (${CHATBOX_ANALYZE_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для тестирования. */
  async process(job: Job<ChatboxAnalyzeJobData>): Promise<void> {
    const { tenantId, sessionId } = job.data;
    this.logger.log(
      `ChatboxAnalyze старт: tenant=${tenantId} session=${sessionId} job=${job.id}`,
    );

    try {
      // 1. Помечаем сессию «в анализе» (tenant-scoped updateMany).
      await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId },
        data: { analysisStatus: 'analyzing' },
      });

      // 2. Best-effort LLM-summary — persist только при наличии.
      const summary = await this.ingest.generateSummary(tenantId, sessionId);
      if (summary !== null) {
        await this.prisma.chatboxChatSession.updateMany({
          where: { id: sessionId, tenantId },
          data: { summary },
        });
      }

      // 3. Мост в knowledge-core. null → сессия ещё открыта/отсутствует:
      //    оставляем pending (sweeper-cron вернётся позже).
      const res = await this.ingest.ingestSession(tenantId, sessionId);
      if (res === null) {
        this.logger.log(
          `ChatboxAnalyze: session=${sessionId} ещё открыта/нет — остаётся pending`,
        );
        return;
      }

      // 4. Успех — фиксируем результат.
      await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId },
        data: {
          analysisStatus: 'done',
          analyzedAt: new Date(),
          rawEventId: res.rawEventId,
        },
      });
      this.logger.log(
        `ChatboxAnalyze готово: session=${sessionId} rawEventId=${res.rawEventId}`,
      );
    } catch (err) {
      // 5. Помечаем failed (best-effort) и пробрасываем для retry BullMQ.
      await this.prisma.chatboxChatSession
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
        'ChatboxAnalyze: ошибка анализа сессии',
      );
      throw err;
    }
  }
}
