import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { IntegrationSyncLogService } from '../integrations-observability/integration-sync-log.service';

import { BitrixIngestService } from './bitrix-ingest.service';
import { BITRIX_ANALYZE_QUEUE, type BitrixAnalyzeJobData } from './queue/bitrix-analyze.queue';

@Injectable()
export class BitrixAnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitrixAnalyzeWorker.name);
  private worker: Worker<BitrixAnalyzeJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BitrixIngestService) private readonly ingest: BitrixIngestService,
    @Optional()
    @Inject(IntegrationSyncLogService)
    private readonly syncLog?: IntegrationSyncLogService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BitrixAnalyzeJobData>(
      BITRIX_ANALYZE_QUEUE,
      async (job) => this.process(job),
      { connection: this.redis.client, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn({ jobId: job?.id, err: err.message }, 'BitrixAnalyzeWorker: job failed');
    });
    this.logger.log(`BitrixAnalyzeWorker запущен (${BITRIX_ANALYZE_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  async process(job: Job<BitrixAnalyzeJobData>): Promise<void> {
    const { tenantId, sessionId } = job.data;
    this.logger.debug(`BitrixAnalyze старт: tenant=${tenantId} session=${sessionId} job=${job.id}`);

    const run =
      (await this.syncLog?.begin({
        tenantId,
        provider: 'bitrix',
        kind: 'analyze',
        refId: sessionId,
      })) ?? null;
    try {
      await this.prisma.bitrixDialogSession.updateMany({
        where: { id: sessionId, tenantId },
        data: { analysisStatus: 'analyzing' },
      });

      await this.ingest.generateDayRollup(tenantId, sessionId);

      const res = await this.ingest.ingestSession(tenantId, sessionId);
      if (res === null) {
        await this.syncLog?.skip(run, 'session open/empty');
        this.logger.debug(`BitrixAnalyze: session=${sessionId} ещё открыта/нет — остаётся pending`);
        return;
      }

      await this.prisma.bitrixDialogSession.updateMany({
        where: { id: sessionId, tenantId },
        data: {
          analysisStatus: 'done',
          analyzedAt: new Date(),
          rawEventId: res.rawEventId,
        },
      });
      await this.syncLog?.succeed(run, { rawEventId: res.rawEventId });
      this.logger.debug(`BitrixAnalyze готово: session=${sessionId} rawEventId=${res.rawEventId}`);
    } catch (err) {
      await this.syncLog?.fail(run, err);
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
