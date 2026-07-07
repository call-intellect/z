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
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { IntegrationSyncLogService } from '../integrations-observability/integration-sync-log.service';

import { ChatboxIngestService } from './chatbox-ingest.service';
import { CHATBOX_ANALYZE_QUEUE, type ChatboxAnalyzeJobData } from './queue/chatbox-analyze.queue';

@Injectable()
export class ChatboxAnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatboxAnalyzeWorker.name);
  private worker: Worker<ChatboxAnalyzeJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxIngestService)
    private readonly ingest: ChatboxIngestService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(IntegrationSyncLogService)
    private readonly syncLog?: IntegrationSyncLogService,
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
      this.logger.warn({ jobId: job?.id, err: err.message }, 'ChatboxAnalyzeWorker: job failed');
    });
    this.logger.log(`ChatboxAnalyzeWorker запущен (${CHATBOX_ANALYZE_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  async process(job: Job<ChatboxAnalyzeJobData>): Promise<void> {
    const { tenantId, sessionId } = job.data;
    this.logger.debug(
      `ChatboxAnalyze старт: tenant=${tenantId} session=${sessionId} job=${job.id}`,
    );

    const run =
      (await this.syncLog?.begin({
        tenantId,
        provider: 'chatbox',
        kind: 'analyze',
        refId: sessionId,
      })) ?? null;
    try {
      const claimed = await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId, analysisStatus: 'pending' },
        data: { analysisStatus: 'analyzing' },
      });
      if (claimed.count === 0) {
        await this.syncLog?.skip(run, 'session not pending (already claimed/done/failed)');
        this.logger.debug(
          `ChatboxAnalyze: session=${sessionId} уже не pending — пропуск (race/idempotency)`,
        );
        return;
      }

      const summary = await this.ingest.generateSummary(tenantId, sessionId);
      if (summary !== null) {
        await this.prisma.chatboxChatSession.updateMany({
          where: { id: sessionId, tenantId },
          data: { summary },
        });
      }

      const res = await this.ingest.ingestSession(tenantId, sessionId);
      if (res === null) {
        await this.syncLog?.skip(run, 'session open/empty');
        this.logger.debug(
          `ChatboxAnalyze: session=${sessionId} ещё открыта/нет — остаётся pending`,
        );
        return;
      }

      await this.prisma.chatboxChatSession.updateMany({
        where: { id: sessionId, tenantId },
        data: {
          analysisStatus: 'done',
          analyzedAt: new Date(),
          rawEventId: res.rawEventId,
        },
      });
      await this.syncLog?.succeed(run, { rawEventId: res.rawEventId });
      this.metrics?.incChatboxAnalyze({ status: 'success' });
      this.logger.debug(`ChatboxAnalyze готово: session=${sessionId} rawEventId=${res.rawEventId}`);
    } catch (err) {
      await this.syncLog?.fail(run, err);
      await this.prisma.chatboxChatSession
        .updateMany({
          where: { id: sessionId, tenantId },
          data: { analysisStatus: 'failed' },
        })
        .catch(() => undefined);
      this.metrics?.incChatboxAnalyze({ status: 'failed' });
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
