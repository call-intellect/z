import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { CurrencyRateService } from './currency-rate.service';

/**
 * SBA α-10 wave 3 — OrgEconomicsCron.
 *
 * Раз в день в 02:00 UTC пересчитывает per-org unit-economics:
 *   - costRubLast30d / costUsdLast30d
 *   - avgCostPerUserRub (cost / active users)
 *   - top features by cost (top-5 taskType'ов)
 *
 * Результат пишется в gauge'ы Prometheus (org_budget_utilization_percent
 * для тех Org, у которых есть OrgBudgetCap) + используется
 * UnitEconomicsService для дашбордов.
 *
 * Per-org с LIMIT 100 и cursor — на больших org'ах процесс не блокируется.
 */
@Injectable()
export class OrgEconomicsCron {
  private readonly logger = new Logger(OrgEconomicsCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrencyRateService) private readonly fx: CurrencyRateService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 2 * * *', { name: 'org-economics' })
  async runScheduled(): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.runForAll();
      this.logger.debug(
        { ...result, durationMs: Date.now() - startedAt },
        'org-economics.cron: проход завершён',
      );
      this.metrics.incOrgEconomicsRun('success');
    } catch (err) {
      this.metrics.incOrgEconomicsRun('failed');
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'org-economics.cron: непойманная ошибка',
      );
    }
  }

  async runForAll(): Promise<{ orgsScanned: number; orgsUpdated: number }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 1000, // hard cap — на больших инстансах TODO: cursor pagination.
    });
    let orgsUpdated = 0;
    const fxRate = await this.fx.getCurrentUsdRubRate();

    for (const org of orgs) {
      try {
        const metrics = await this.computeForOrg(org.id, fxRate);
        // Если есть OrgBudgetCap.monthlyCapRub — обновляем gauge utilization.
        const cap = await this.prisma.orgBudgetCap.findUnique({
          where: { tenantId: org.id },
          select: { monthlyCapRub: true },
        });
        if (cap?.monthlyCapRub) {
          const limit = Number(cap.monthlyCapRub);
          if (limit > 0) {
            const utilization =
              (metrics.costRubMonthToDate / limit) * 100;
            this.metrics.setOrgBudgetUtilizationPercent({
              tenantTop: this.tenantTopBucket(org.id),
              percent: utilization,
            });
          }
        }
        orgsUpdated++;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'org-economics.cron: ошибка для tenant — продолжаю',
        );
      }
    }

    return { orgsScanned: orgs.length, orgsUpdated };
  }

  /**
   * Public — нужен также UnitEconomicsService для on-demand-расчёта.
   */
  async computeForOrg(
    tenantId: string,
    fxRate: number,
  ): Promise<{
    costUsdLast30d: number;
    costRubLast30d: number;
    costRubMonthToDate: number;
    callsCountLast30d: number;
    avgCostPerUserRub: number;
    activeUsersLast30d: number;
    topTaskTypes: Array<{
      taskType: string;
      costRub: number;
      calls: number;
    }>;
  }> {
    const now = new Date();
    const start30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    type SumRow = {
      cost_usd: string | null;
      cost_rub: string | null;
      calls: bigint;
    };
    const [sum30d] = await this.prisma.$queryRaw<SumRow[]>`
      SELECT COALESCE(SUM("costUsd"), 0)::text  AS cost_usd,
             COALESCE(SUM("costRub"), 0)::text  AS cost_rub,
             COUNT(*)::bigint                   AS calls
      FROM "AiUsageLog"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${start30d}
    `;
    const [sumMtd] = await this.prisma.$queryRaw<SumRow[]>`
      SELECT COALESCE(SUM("costUsd"), 0)::text  AS cost_usd,
             COALESCE(SUM("costRub"), 0)::text  AS cost_rub,
             COUNT(*)::bigint                   AS calls
      FROM "AiUsageLog"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${startOfMonth}
    `;

    const usd30d = Number.parseFloat(sum30d?.cost_usd ?? '0') || 0;
    let rub30d = Number.parseFloat(sum30d?.cost_rub ?? '0') || 0;
    if (rub30d === 0 && usd30d > 0) rub30d = usd30d * fxRate;
    let rubMtd = Number.parseFloat(sumMtd?.cost_rub ?? '0') || 0;
    const usdMtd = Number.parseFloat(sumMtd?.cost_usd ?? '0') || 0;
    if (rubMtd === 0 && usdMtd > 0) rubMtd = usdMtd * fxRate;

    const callsCount = Number(sum30d?.calls ?? 0);
    const activeUsersLast30d = await this.prisma.aiUsageLog
      .findMany({
        where: { tenantId, createdAt: { gte: start30d } },
        distinct: ['userId'],
        select: { userId: true },
      })
      .then((rows) => rows.filter((r) => r.userId).length);

    const avgCostPerUserRub =
      activeUsersLast30d > 0 ? rub30d / activeUsersLast30d : 0;

    const topRows = await this.prisma.$queryRaw<
      Array<{ task_type: string | null; cost_rub: string | null; calls: bigint }>
    >`
      SELECT "taskType"  AS task_type,
             COALESCE(SUM("costRub"), 0)::text AS cost_rub,
             COUNT(*)::bigint                  AS calls
      FROM "AiUsageLog"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${start30d}
        AND "taskType" IS NOT NULL
      GROUP BY "taskType"
      ORDER BY SUM("costRub") DESC NULLS LAST
      LIMIT 5
    `;

    return {
      costUsdLast30d: usd30d,
      costRubLast30d: rub30d,
      costRubMonthToDate: rubMtd,
      callsCountLast30d: callsCount,
      avgCostPerUserRub,
      activeUsersLast30d,
      topTaskTypes: topRows.map((r) => {
        let rub = Number.parseFloat(r.cost_rub ?? '0') || 0;
        if (rub === 0 && usd30d > 0) {
          // не точно, но лучше чем 0 для UX
          rub = 0;
        }
        return {
          taskType: r.task_type ?? 'unknown',
          costRub: rub,
          calls: Number(r.calls),
        };
      }),
    };
  }

  /**
   * Cardinality-safe бакетизация tenantId для метрик. На MVP — первые 8
   * символов; на масштабе сотен Org этого достаточно. На > 1k тенантов —
   * заменить на hash%64.
   */
  private tenantTopBucket(tenantId: string): string {
    return tenantId.slice(0, 8);
  }
}
