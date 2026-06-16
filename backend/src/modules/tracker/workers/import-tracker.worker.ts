import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ImportLog, Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { S3Service } from '../../recordings/s3.service';
import type { ImportErrorEntry } from '../dto/imports/import-log-response.dto';
import { type ImportTrackerJobData, TRACKER_QUEUE_NAMES } from '../queues';
import { TrackerEventsService } from '../services/tracker-events.service';
import { Bitrix24ImportStrategy } from '../strategies/bitrix24-import.strategy';
import type {
  ImportResult,
  ImportStrategy,
  ImportStrategyServices,
} from '../strategies/import-strategy.interface';
import { TrelloImportStrategy } from '../strategies/trello-import.strategy';
import { YandexTrackerImportStrategy } from '../strategies/yandex-tracker-import.strategy';

@Injectable()
export class ImportTrackerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportTrackerWorker.name);
  private worker: Worker<ImportTrackerJobData> | null = null;

  private static readonly PROGRESS_THROTTLE_MS = 5_000;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TrelloImportStrategy)
    private readonly trello: TrelloImportStrategy,
    @Inject(Bitrix24ImportStrategy)
    private readonly bitrix: Bitrix24ImportStrategy,
    @Inject(YandexTrackerImportStrategy)
    private readonly yandex: YandexTrackerImportStrategy,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ImportTrackerJobData>(
      TRACKER_QUEUE_NAMES.IMPORT_TRACKER,
      async (job) =>
        this.pipe.job(SystemLogPipeline.INTEGRATIONS, 'tracker.import', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobId: job?.id,
          importLogId: job?.data?.importLogId,
          err: err?.message,
        },
        'import-tracker: job failed (attempts=1, не будет retry)',
      );
    });
    this.logger.debug(
      `ImportTrackerWorker запущен (${TRACKER_QUEUE_NAMES.IMPORT_TRACKER}, concurrency=2)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        this.logger.warn(
          `import-tracker: ошибка close: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.worker = null;
    }
  }

  async process(job: Job<ImportTrackerJobData>): Promise<void> {
    const { tenantId, importLogId } = job.data;

    const importLog = await this.prisma.importLog.findFirst({
      where: { id: importLogId, tenantId },
    });
    if (!importLog) {
      this.logger.warn({ importLogId, tenantId }, 'import-tracker: ImportLog не найден — пропуск');
      return;
    }
    if (importLog.status !== 'running') {
      this.logger.debug(
        { importLogId, status: importLog.status },
        'import-tracker: status не running — пропуск',
      );
      return;
    }

    const tenantTop = tenantTopOf(tenantId);
    const source = importLog.source as 'trello' | 'bitrix24' | 'yandex_tracker';
    const strategy = this.resolveStrategy(source);
    if (!strategy) {
      await this.finalizeFailed({
        importLog,
        error: `Неизвестный source: ${importLog.source}`,
        tenantTop,
      });
      return;
    }

    const services: ImportStrategyServices = {
      prisma: this.prisma,
      s3: this.s3,
      metrics: this.metrics,
      events: this.events,
    };

    let lastProgressAt = 0;
    const onProgress = async (args: {
      processed: number;
      total: number;
      phase: string;
    }): Promise<void> => {
      const now = Date.now();
      if (
        now - lastProgressAt < ImportTrackerWorker.PROGRESS_THROTTLE_MS &&
        args.phase !== 'finalizing'
      ) {
        return;
      }
      lastProgressAt = now;
      this.events.publishImportProgress({
        tenantId,
        importLogId,
        processed: args.processed,
        total: args.total,
        phase: args.phase,
      });
    };

    let result: ImportResult;
    try {
      result = await strategy.run({
        importLog,
        params: (importLog.paramsJson as Record<string, unknown> | null) ?? {},
        services,
        onProgress,
      });
    } catch (err) {
      this.logger.error(
        {
          importLogId,
          source: importLog.source,
          err: err instanceof Error ? err.message : String(err),
        },
        'import-tracker: fatal error при импорте',
      );
      await this.finalizeFailed({
        importLog,
        error: err instanceof Error ? err.message : String(err),
        tenantTop,
      });
      return;
    }

    const fresh = await this.prisma.importLog
      .findUnique({
        where: { id: importLogId },
        select: { status: true },
      })
      .catch(() => null);
    if (fresh?.status === 'cancelled') {
      await this.prisma.importLog
        .update({
          where: { id: importLog.id },
          data: {
            totalProjects: result.totalProjects,
            totalIssues: result.totalIssues,
            totalComments: result.totalComments,
            totalAttachments: result.totalAttachments,
            errors: result.errors as unknown as Prisma.InputJsonValue,
            unmatchedJson: result.unmatchedEmails as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      this.metrics?.incImportCompleted({
        tenantTop,
        source,
        success: false,
      });
      this.events.publishImportFailed({
        tenantId,
        importLogId,
        error: 'cancelled',
      });
      return;
    }

    await this.prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        totalProjects: result.totalProjects,
        totalIssues: result.totalIssues,
        totalComments: result.totalComments,
        totalAttachments: result.totalAttachments,
        errors: result.errors as unknown as Prisma.InputJsonValue,
        unmatchedJson: result.unmatchedEmails as unknown as Prisma.InputJsonValue,
      },
    });
    this.metrics?.incImportCompleted({
      tenantTop,
      source,
      success: true,
    });
    this.events.publishImportCompleted({
      tenantId,
      importLogId,
      summary: {
        totalProjects: result.totalProjects,
        totalIssues: result.totalIssues,
        totalComments: result.totalComments,
        totalAttachments: result.totalAttachments,
        errors: result.errors.length,
      },
    });
    this.logger.debug(
      {
        importLogId,
        source,
        totalProjects: result.totalProjects,
        totalIssues: result.totalIssues,
      },
      'import-tracker: импорт успешно завершён',
    );
  }

  private resolveStrategy(source: 'trello' | 'bitrix24' | 'yandex_tracker'): ImportStrategy | null {
    switch (source) {
      case 'trello':
        return this.trello;
      case 'bitrix24':
        return this.bitrix;
      case 'yandex_tracker':
        return this.yandex;
      default:
        return null;
    }
  }

  private async finalizeFailed(args: {
    importLog: ImportLog;
    error: string;
    tenantTop: string;
  }): Promise<void> {
    const errorEntry: ImportErrorEntry = {
      stage: 'fatal',
      message: args.error,
      timestamp: new Date().toISOString(),
    };
    const prev = Array.isArray(args.importLog.errors) ? (args.importLog.errors as unknown[]) : [];
    await this.prisma.importLog
      .update({
        where: { id: args.importLog.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errors: [...prev, errorEntry] as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((e) =>
        this.logger.warn(
          `import-tracker: не удалось записать failed-статус: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    this.metrics?.incImportCompleted({
      tenantTop: args.tenantTop,
      source: args.importLog.source as 'trello' | 'bitrix24' | 'yandex_tracker',
      success: false,
    });
    this.events.publishImportFailed({
      tenantId: args.importLog.tenantId,
      importLogId: args.importLog.id,
      error: args.error,
    });
  }
}
