import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { CurrencyRateService } from './currency-rate.service';

/**
 * SBA α-10 wave 3 — DailyCostAggregatorCron.
 *
 * Раз в день в 01:00 UTC агрегирует AiUsageLog за вчера в AiCostDaily.
 * Идемпотентен: jobId pattern `cost-aggregate_${date}` — пересчёт того же
 * дня перезаписывает строки (upsert по unique [tenant, date, taskType,
 * provider, model]).
 *
 * Cost considerations:
 *   - Одна реплика БД, агрегация одного дня обычно <1 минуты на типовом
 *     volume (~100k вызовов).
 *   - costUsd / costRub берутся из snapshot полей AiUsageLog (если есть) или
 *     пересчитываются через текущий CurrencyRate (для backward-compat с
 *     vintage записями без snapshot'а).
 *
 * См. ТЗ §8.
 */
@Injectable()
export class DailyCostAggregatorCron {
  private readonly logger = new Logger(DailyCostAggregatorCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrencyRateService) private readonly fx: CurrencyRateService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 1 * * *', { name: 'daily-cost-aggregator' })
  async runScheduled(): Promise<void> {
    const startedAt = Date.now();
    try {
      const yesterday = this.yesterdayUtcDate();
      const result = await this.runForDate(yesterday);
      this.logger.debug(
        { ...result, durationMs: Date.now() - startedAt },
        'daily-cost-aggregator.cron: проход завершён',
      );
      this.metrics.incDailyCostAggregatorRun('success');
    } catch (err) {
      this.metrics.incDailyCostAggregatorRun('failed');
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'daily-cost-aggregator.cron: непойманная ошибка',
      );
    }
  }

  /**
   * Public — для manual trigger из admin (POST /admin/unit-economics/aggregate).
   * date в UTC, агрегация ровно одного дня [00:00, 24:00) UTC.
   */
  async runForDate(date: Date): Promise<{
    date: string;
    rowsAggregated: number;
    rowsUpserted: number;
  }> {
    const dayStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const fxRate = await this.fx.getCurrentUsdRubRate();

    // Группировка через raw SQL — Prisma.groupBy не позволяет суммировать
    // одновременно по нескольким Decimal-полям + считать count в одной
    // выборке с фильтром по date range достаточно эффективно.
    type Row = {
      tenant_id: string;
      task_type: string | null;
      provider: string;
      model: string;
      calls_count: bigint;
      calls_success: bigint;
      input_tokens: bigint;
      output_tokens: bigint;
      cached_tokens: bigint;
      cost_usd_sum: string | null;
      cost_rub_sum: string | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        "tenantId"     AS tenant_id,
        "taskType"     AS task_type,
        provider       AS provider,
        model          AS model,
        COUNT(*)::bigint                                          AS calls_count,
        COUNT(*) FILTER (WHERE success = true)::bigint            AS calls_success,
        COALESCE(SUM("inputTokens"), 0)::bigint                   AS input_tokens,
        COALESCE(SUM("outputTokens"), 0)::bigint                  AS output_tokens,
        COALESCE(SUM("cachedTokens"), 0)::bigint                  AS cached_tokens,
        COALESCE(SUM("costUsd"), 0)::text                         AS cost_usd_sum,
        COALESCE(SUM("costRub"), 0)::text                         AS cost_rub_sum
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${dayStart}
        AND "createdAt" <  ${dayEnd}
        AND "tenantId" IS NOT NULL
      GROUP BY "tenantId", "taskType", provider, model
    `;

    let upserted = 0;
    for (const r of rows) {
      const taskType = r.task_type ?? 'unknown';
      const costUsd = Number.parseFloat(r.cost_usd_sum ?? '0') || 0;
      let costRub = Number.parseFloat(r.cost_rub_sum ?? '0') || 0;
      if (costRub === 0 && costUsd > 0) {
        // У части vintage-записей costRub=null/0 — досчитываем через текущий курс.
        costRub = costUsd * fxRate;
      }
      try {
        await this.prisma.aiCostDaily.upsert({
          where: {
            tenantId_date_taskType_provider_model: {
              tenantId: r.tenant_id,
              date: dayStart,
              taskType,
              provider: r.provider,
              model: r.model,
            },
          },
          create: {
            tenantId: r.tenant_id,
            date: dayStart,
            taskType,
            provider: r.provider,
            model: r.model,
            callsCount: Number(r.calls_count),
            callsSuccess: Number(r.calls_success),
            costUsd: new Prisma.Decimal(costUsd.toFixed(6)),
            costRub: new Prisma.Decimal(costRub.toFixed(4)),
            inputTokens: Number(r.input_tokens),
            outputTokens: Number(r.output_tokens),
            cachedTokens: Number(r.cached_tokens),
            recalculatedAt: new Date(),
          },
          update: {
            callsCount: Number(r.calls_count),
            callsSuccess: Number(r.calls_success),
            costUsd: new Prisma.Decimal(costUsd.toFixed(6)),
            costRub: new Prisma.Decimal(costRub.toFixed(4)),
            inputTokens: Number(r.input_tokens),
            outputTokens: Number(r.output_tokens),
            cachedTokens: Number(r.cached_tokens),
            recalculatedAt: new Date(),
          },
        });
        upserted++;
      } catch (err) {
        this.logger.warn(
          {
            tenant: r.tenant_id,
            task: taskType,
            provider: r.provider,
            model: r.model,
            err: err instanceof Error ? err.message : String(err),
          },
          'daily-cost-aggregator: upsert не удался — продолжаю',
        );
      }
    }

    return {
      date: dayStart.toISOString().slice(0, 10),
      rowsAggregated: rows.length,
      rowsUpserted: upserted,
    };
  }

  private yesterdayUtcDate(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - 1,
      ),
    );
  }
}
