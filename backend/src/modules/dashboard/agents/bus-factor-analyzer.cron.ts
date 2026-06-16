import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Pulse Wave 6 §6.1 — Bus-Factor-Analyzer cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §6.1.
 *
 * Weekly (`@Cron('0 5 * * 1')`, понедельник 05:00 UTC — после Forecaster
 * 04:00) для каждой Org агрегирует `PersonKnowledgeCategoryEmbedding` по
 * `categoryName`. Для каждой категории считает:
 *   - highConfidenceCount: число Person с `confidence='high'`.
 *   - totalExpertsCount:   число Person с `confidence ∈ ('high','medium')`.
 *   - riskLevel:           'critical' (≤1 expert) | 'warning' (2-3) | 'ok' (≥4).
 *   - topExpertsJson:      топ-5 Person для UI (high → medium).
 *
 * Запись — отдельный snapshot per category в `KnowledgeRiskSnapshot`. История
 * не перезаписывается: UI читает последний snapshot per (tenantId, categoryName).
 *
 * Без LLM — чистая SQL-агрегация + in-memory groupBy.
 *
 * Best-effort: ошибка по одной Org не валит остальных.
 */
@Injectable()
export class BusFactorAnalyzerCron {
  private readonly logger = new Logger(BusFactorAnalyzerCron.name);
  /** Жёсткий лимит на размер выборки Org-ов за прогон. */
  private static readonly MAX_ORGS_PER_RUN = 5_000;
  /** Сколько топ-экспертов сохранить в `topExpertsJson`. */
  private static readonly TOP_EXPERTS_LIMIT = 5;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Weekly Mon 05:00 UTC (после Forecaster 04:00). */
  @Cron('0 5 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'bus-factor-analyzer.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `bus-factor-analyzer.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    orgsProcessed: number;
    snapshotsCreated: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: BusFactorAnalyzerCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let snapshotsCreated = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        snapshotsCreated += await this.processOrg(org.id);
      } catch (err) {
        errors++;
        this.logger.warn(
          `bus-factor-analyzer org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orgsProcessed, snapshotsCreated, errors };
  }

  private async processOrg(tenantId: string): Promise<number> {
    const rows = await this.prisma.personKnowledgeCategoryEmbedding.findMany({
      where: { tenantId },
      select: {
        categoryName: true,
        confidence: true,
        personId: true,
        person: { select: { name: true, deletedAt: true } },
      },
    });

    if (rows.length === 0) return 0;

    // Группируем по categoryName, учитывая только живых Person'ов.
    const byCategory = new Map<
      string,
      Array<{ personId: string; name: string; confidence: string }>
    >();
    for (const r of rows) {
      if (!r.person || r.person.deletedAt) continue;
      const list = byCategory.get(r.categoryName) ?? [];
      list.push({
        personId: r.personId,
        name: r.person.name,
        confidence: r.confidence,
      });
      byCategory.set(r.categoryName, list);
    }

    if (byCategory.size === 0) return 0;

    let created = 0;
    for (const [categoryName, experts] of byCategory) {
      const high = experts.filter((e) => e.confidence === 'high');
      const medium = experts.filter((e) => e.confidence === 'medium');
      const highConfidenceCount = high.length;
      const totalExpertsCount = high.length + medium.length;
      const riskLevel = computeRiskLevel(highConfidenceCount);

      // Топ для UI: высокие сначала, затем средние; обрезаем до TOP_EXPERTS_LIMIT.
      const topExperts = [...high, ...medium].slice(
        0,
        BusFactorAnalyzerCron.TOP_EXPERTS_LIMIT,
      );

      await this.prisma.knowledgeRiskSnapshot.create({
        data: {
          tenantId,
          categoryName,
          highConfidenceCount,
          totalExpertsCount,
          riskLevel,
          topExpertsJson: { experts: topExperts } as unknown as Prisma.InputJsonValue,
        },
      });
      created++;
    }

    return created;
  }
}

/**
 * Bus-Factor risk-level правила (§6.1):
 *   - 0-1 high-эксперт  → 'critical' (угроза непрерывности).
 *   - 2-3 high-эксперта → 'warning'.
 *   - ≥4 high-эксперта  → 'ok'.
 */
export function computeRiskLevel(
  highConfidenceCount: number,
): 'critical' | 'warning' | 'ok' {
  if (highConfidenceCount <= 1) return 'critical';
  if (highConfidenceCount <= 3) return 'warning';
  return 'ok';
}
