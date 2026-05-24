import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ImportLog, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type {
  ImportLogResponseDto,
  ListImportLogsResponseDto,
} from '../dto/imports/import-log-response.dto';
import {
  IMPORT_TRACKER_JOB_OPTIONS,
  type ImportTrackerJobData,
  TRACKER_QUEUE_NAMES,
} from '../queues';

export type ImportSource = 'trello' | 'bitrix24' | 'yandex_tracker';

/**
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — ImportService.
 *
 * Точка входа админ-импорта:
 *  - `start` — создаёт ImportLog и ставит job в очередь `core.imports`.
 *    paramsJson хранится в БД (jsonContent может быть мегабайтами;
 *    Redis-job минимален: { tenantId, importLogId }).
 *  - `getById` / `list` — для UI прогресса.
 *  - `cancel` — помечает status='cancelled'; worker регулярно (между батчами
 *    по 50 items) перечитывает status и прерывает работу.
 *
 * Queue владеется этим сервисом (продьюсер). Consumer — `ImportTrackerWorker`
 * (см. `workers/import-tracker.worker.ts`), тот же модуль.
 */
@Injectable()
export class ImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportService.name);
  private queue: Queue<ImportTrackerJobData> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue<ImportTrackerJobData>(
      TRACKER_QUEUE_NAMES.IMPORT_TRACKER,
      {
        connection: this.redis.client,
        defaultJobOptions: IMPORT_TRACKER_JOB_OPTIONS,
      },
    );
    this.logger.log(
      `ImportService инициализирован (queue=${TRACKER_QUEUE_NAMES.IMPORT_TRACKER})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        this.logger.warn(
          `ImportService: ошибка при закрытии очереди ${TRACKER_QUEUE_NAMES.IMPORT_TRACKER}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.queue = null;
    }
  }

  /**
   * Стартует импорт: создаёт ImportLog в статусе 'running' и enqueue job.
   *
   * @returns id созданного ImportLog (для frontend wizard).
   */
  async start(args: {
    tenantId: string;
    userId: string;
    source: ImportSource;
    paramsJson: unknown;
  }): Promise<{ importLogId: string }> {
    const { tenantId, userId, source, paramsJson } = args;
    const created = await this.prisma.importLog.create({
      data: {
        tenantId,
        source,
        status: 'running',
        initiatedByUserId: userId,
        paramsJson: (paramsJson ?? null) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    if (!this.queue) {
      // Сценарий: контроллер позвал до onModuleInit (тесты / странный bootstrap).
      // Помечаем ImportLog как failed, бросаем — caller получит явную ошибку.
      await this.prisma.importLog
        .update({
          where: { id: created.id },
          data: { status: 'failed', completedAt: new Date() },
        })
        .catch(() => undefined);
      throw new Error(
        'ImportService: queue не инициализирована (onModuleInit не отработал)',
      );
    }
    try {
      await this.queue.add(
        'import-tracker',
        { tenantId, importLogId: created.id },
        { jobId: `import-tracker:${created.id}` },
      );
    } catch (err) {
      await this.prisma.importLog
        .update({
          where: { id: created.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errors: [
              {
                stage: 'enqueue',
                message: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString(),
              },
            ] as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      throw err;
    }

    this.metrics?.incImportStarted({
      tenantTop: tenantTopOf(tenantId),
      source,
    });
    this.logger.log(
      { importLogId: created.id, tenantId, source, userId },
      'ImportService.start: импорт поставлен в очередь',
    );
    return { importLogId: created.id };
  }

  /** Получить ImportLog (с последними 50 ошибками). */
  async getById(args: {
    tenantId: string;
    importLogId: string;
  }): Promise<ImportLogResponseDto> {
    const row = await this.prisma.importLog.findFirst({
      where: { id: args.importLogId, tenantId: args.tenantId },
    });
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'import_log_not_found',
          message: 'Импорт не найден',
        },
      });
    }
    return this.toResponse(row);
  }

  /**
   * Список ImportLog текущего tenant'а. Cursor-based пагинация по id (desc):
   * cursor = id последней записи предыдущей страницы.
   */
  async list(args: {
    tenantId: string;
    limit: number;
    cursor?: string;
    source?: ImportSource;
    status?: string;
  }): Promise<ListImportLogsResponseDto> {
    const where: Prisma.ImportLogWhereInput = { tenantId: args.tenantId };
    if (args.cursor) where.id = { lt: args.cursor };
    if (args.source) where.source = args.source;
    if (args.status) where.status = args.status;
    const rows = await this.prisma.importLog.findMany({
      where,
      orderBy: [{ id: 'desc' }],
      take: args.limit + 1,
    });
    const hasMore = rows.length > args.limit;
    const pageItems = hasMore ? rows.slice(0, args.limit) : rows;
    const nextCursor = hasMore
      ? (pageItems[pageItems.length - 1]?.id ?? null)
      : null;
    return {
      items: pageItems.map((r) => this.toResponse(r)),
      nextCursor,
      limit: args.limit,
    };
  }

  /**
   * Помечает ImportLog как cancelled. Worker сам проверяет status между
   * батчами (каждые 50 items в TrelloImportStrategy) и прерывает работу.
   * На уже completed/failed возвращает 404-like (нечего отменять).
   */
  async cancel(args: {
    tenantId: string;
    importLogId: string;
  }): Promise<ImportLogResponseDto> {
    const row = await this.prisma.importLog.findFirst({
      where: { id: args.importLogId, tenantId: args.tenantId },
    });
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'import_log_not_found',
          message: 'Импорт не найден',
        },
      });
    }
    if (row.status !== 'running') {
      // Идемпотентно: уже завершён в каком-то терминальном статусе.
      return this.toResponse(row);
    }
    const updated = await this.prisma.importLog.update({
      where: { id: row.id },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    return this.toResponse(updated);
  }

  // ── mappers ────────────────────────────────────────────────────────

  private toResponse(row: ImportLog): ImportLogResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      source: row.source,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      totalProjects: row.totalProjects,
      totalIssues: row.totalIssues,
      totalComments: row.totalComments,
      totalAttachments: row.totalAttachments,
      processedItems: row.processedItems,
      // errors / paramsJson / unmatchedJson могут быть null / любым JSON.
      // Возвращаем как unknown для прозрачной сериализации.
      errors: row.errors as unknown,
      status: row.status,
      paramsJson: row.paramsJson as unknown,
      unmatchedJson: row.unmatchedJson as unknown,
      initiatedByUserId: row.initiatedByUserId,
    };
  }
}
