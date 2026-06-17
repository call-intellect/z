import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { SimilarIssueDto } from '../dto/issues/similar-issue.dto';

/**
 * Tracker Phase 3 (Sprint 6, 2026-05-24) — KNN-поиск «похожих задач»
 * по pgvector cosine на `Issue.embedding`.
 *
 *  - Использует HNSW-индекс (`Issue_embedding_hnsw_cosine_idx`, см.
 *    scripts/postgres-init.sql §"Tracker Phase 3"). Без индекса — O(n)
 *    seq-scan по всем Issue в tenant'е.
 *  - Threshold по distance (`embedding <=> $`), не по similarity, потому что
 *    pgvector умеет index-only сортировку по distance.
 *  - Tenant-scope обязателен на всех запросах (multi-tenancy).
 */
@Injectable()
export class SimilarIssuesService {
  private readonly logger = new Logger(SimilarIssuesService.name);
  /** Distance threshold по умолчанию (≈ similarity ≥ 0.82). */
  static readonly DEFAULT_THRESHOLD = 0.18;
  static readonly DEFAULT_LIMIT = 5;
  static readonly MAX_LIMIT = 20;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Найти похожие задачи.
   *
   * @param args.tenantId  — обязателен, isolation.
   * @param args.issueId   — исходная задача.
   * @param args.limit     — кол-во (default 5, max 20).
   * @param args.threshold — порог по distance (default 0.18). Ниже = ближе.
   *
   * @returns массив `SimilarIssueDto`. Пустой если у исходной задачи
   *  embedding ещё не посчитан (worker не отработал) или нет соседей
   *  в пределах threshold.
   */
  async findSimilar(args: {
    tenantId: string;
    issueId: string;
    limit?: number;
    threshold?: number;
  }): Promise<SimilarIssueDto[]> {
    // Метрика «выполнен поиск похожих» — на каждый вызов read-эндпоинта, даже
    // если у seed-задачи нет embedding (поведение до рефактора findSimilarByVector).
    this.metrics.incTrackerIssueSimilarSearch({
      tenantTop: tenantTopOf(args.tenantId),
    });

    // 1. Загружаем embedding исходной задачи как text literal (pgvector
    //    отдаёт `'[v1,v2,...]'` если SELECT'ить как text).
    const seedRows = await this.prisma.$queryRawUnsafe<
      Array<{ embedding: string | null }>
    >(
      'SELECT embedding::text AS embedding FROM "Issue" WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL',
      args.issueId,
      args.tenantId,
    );
    const seed = seedRows[0];
    if (!seed?.embedding) {
      // Нет embedding'а — поиск невозможен. Не ошибка: воркер ещё не
      // отработал ИЛИ задача без текста.
      this.logger.debug(
        { issueId: args.issueId },
        'similar-issues: у исходной задачи нет embedding — empty result',
      );
      return [];
    }

    return this.findSimilarByVector({
      tenantId: args.tenantId,
      embedding: seed.embedding,
      limit: args.limit,
      threshold: args.threshold,
      excludeIssueId: args.issueId,
    });
  }

  /**
   * KNN-поиск похожих задач по уже посчитанному вектору (text-литерал pgvector
   * `'[v1,v2,...]'`). Вынесено из `findSimilar` (TZ task-dedup, 2026-06-16):
   * дедуп задаёт вектор кандидата напрямую (синхронный embed на лету), без
   * существующего `Issue.embedding`.
   *
   * @param args.tenantId       — обязателен, isolation.
   * @param args.embedding      — вектор-кандидат как pgvector text-литерал.
   * @param args.limit          — кол-во (default 5, max 20).
   * @param args.threshold      — порог по distance (default 0.18). Ниже = ближе.
   * @param args.excludeIssueId — исключить эту задачу из результата (опц.).
   * @param args.openOnly       — true → только незакрытые (`completedAt IS NULL`);
   *                              для дедупа (ищем среди открытых задач).
   */
  async findSimilarByVector(args: {
    tenantId: string;
    embedding: string;
    limit?: number;
    threshold?: number;
    excludeIssueId?: string;
    openOnly?: boolean;
  }): Promise<SimilarIssueDto[]> {
    // Метрика инкрементится в `findSimilar` (read-эндпоинт). Прямые вызовы
    // findSimilarByVector (дедуп) — отдельный flow, в этот счётчик не входят.
    const limit = Math.min(
      Math.max(1, args.limit ?? SimilarIssuesService.DEFAULT_LIMIT),
      SimilarIssuesService.MAX_LIMIT,
    );
    const threshold = args.threshold ?? SimilarIssuesService.DEFAULT_THRESHOLD;

    // Динамический WHERE: tenant + embedding + (опц.) исключение задачи и
    // фильтр открытых. Параметры нумеруются по мере добавления, чтобы
    // pgvector index-only сортировка по distance оставалась валидной.
    const params: unknown[] = [args.embedding, args.tenantId];
    const conditions: string[] = [
      '"tenantId" = $2',
      'embedding IS NOT NULL',
      '"deletedAt" IS NULL',
    ];
    if (args.excludeIssueId) {
      params.push(args.excludeIssueId);
      conditions.push(`id <> $${params.length}`);
    }
    if (args.openOnly) {
      conditions.push('"completedAt" IS NULL');
    }
    // limit*2 запас до фильтрации по threshold — часть кандидатов может
    // отвалиться по дистанции.
    params.push(limit * 2);
    const limitParamIdx = params.length;

    const candidates = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        identifier: string;
        title: string;
        stateId: string | null;
        projectId: string;
        completedAt: Date | null;
        distance: number;
      }>
    >(
      `SELECT
         id,
         identifier,
         title,
         "stateId",
         "completedAt",
         "projectId",
         (embedding <=> $1::vector) AS distance
       FROM "Issue"
       WHERE ${conditions.join('\n         AND ')}
       ORDER BY embedding <=> $1::vector
       LIMIT $${limitParamIdx}`,
      ...params,
    );

    const result: SimilarIssueDto[] = [];
    for (const row of candidates) {
      if (row.distance > threshold) continue;
      result.push({
        id: row.id,
        identifier: row.identifier,
        title: row.title,
        stateId: row.stateId,
        projectId: row.projectId,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        similarity: this.clamp01(1 - row.distance),
      });
      if (result.length >= limit) break;
    }
    return result;
  }

  /** Защита от floating-point: distance может прийти как 1.0000000002. */
  private clamp01(v: number): number {
    if (Number.isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }
}
