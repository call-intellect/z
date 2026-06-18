import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { CurrencyRateService } from './currency-rate.service';
import { OrgEconomicsCron } from './org-economics.cron';

@Injectable()
export class UnitEconomicsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurrencyRateService) private readonly fx: CurrencyRateService,
    @Inject(OrgEconomicsCron) private readonly economics: OrgEconomicsCron,
  ) {}

  async getGlobal(args: { days: number; topN: number }): Promise<{
    period: { fromIso: string; toIso: string; days: number };
    totals: { costUsd: number; costRub: number; callsCount: number };
    topOrgs: Array<{ tenantId: string; orgName: string; costRub: number; calls: number }>;
    byTaskType: Array<{ taskType: string; costRub: number; calls: number }>;
  }> {
    const now = new Date();
    const from = new Date(now.getTime() - args.days * 24 * 3600 * 1000);
    const fxRate = await this.fx.getCurrentUsdRubRate();

    type TotalRow = {
      cost_usd: string | null;
      cost_rub: string | null;
      calls: bigint;
    };
    const [totalsRow] = await this.prisma.$queryRaw<TotalRow[]>`
      SELECT COALESCE(SUM("costUsd"), 0)::text AS cost_usd,
             COALESCE(SUM("costRub"), 0)::text AS cost_rub,
             COUNT(*)::bigint                  AS calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${from}
    `;
    const costUsd = Number.parseFloat(totalsRow?.cost_usd ?? '0') || 0;
    let costRub = Number.parseFloat(totalsRow?.cost_rub ?? '0') || 0;
    if (costRub === 0 && costUsd > 0) costRub = costUsd * fxRate;

    type TopOrgRow = {
      tenant_id: string;
      cost_rub: string | null;
      cost_usd: string | null;
      calls: bigint;
    };
    const topRows = await this.prisma.$queryRaw<TopOrgRow[]>`
      SELECT "tenantId"                          AS tenant_id,
             COALESCE(SUM("costRub"), 0)::text   AS cost_rub,
             COALESCE(SUM("costUsd"), 0)::text   AS cost_usd,
             COUNT(*)::bigint                    AS calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${from}
        AND "tenantId" IS NOT NULL
      GROUP BY "tenantId"
      ORDER BY SUM("costRub") DESC NULLS LAST, SUM("costUsd") DESC NULLS LAST
      LIMIT ${args.topN}
    `;
    const orgIds = topRows.map((r) => r.tenant_id);
    const orgsMap = new Map<string, string>();
    if (orgIds.length > 0) {
      const orgs = await this.prisma.org.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true },
      });
      for (const o of orgs) orgsMap.set(o.id, o.name);
    }

    const byTaskRows = await this.prisma.$queryRaw<
      Array<{
        task_type: string | null;
        cost_rub: string | null;
        cost_usd: string | null;
        calls: bigint;
      }>
    >`
      SELECT "taskType"                         AS task_type,
             COALESCE(SUM("costRub"), 0)::text  AS cost_rub,
             COALESCE(SUM("costUsd"), 0)::text  AS cost_usd,
             COUNT(*)::bigint                   AS calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${from}
        AND "taskType" IS NOT NULL
      GROUP BY "taskType"
      ORDER BY SUM("costRub") DESC NULLS LAST
      LIMIT 50
    `;

    return {
      period: {
        fromIso: from.toISOString(),
        toIso: now.toISOString(),
        days: args.days,
      },
      totals: {
        costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
        costRub: Math.round(costRub * 100) / 100,
        callsCount: Number(totalsRow?.calls ?? 0),
      },
      topOrgs: topRows.map((r) => {
        let rub = Number.parseFloat(r.cost_rub ?? '0') || 0;
        const usd = Number.parseFloat(r.cost_usd ?? '0') || 0;
        if (rub === 0 && usd > 0) rub = usd * fxRate;
        return {
          tenantId: r.tenant_id,
          orgName: orgsMap.get(r.tenant_id) ?? r.tenant_id,
          costRub: Math.round(rub * 100) / 100,
          calls: Number(r.calls),
        };
      }),
      byTaskType: byTaskRows.map((r) => {
        let rub = Number.parseFloat(r.cost_rub ?? '0') || 0;
        const usd = Number.parseFloat(r.cost_usd ?? '0') || 0;
        if (rub === 0 && usd > 0) rub = usd * fxRate;
        return {
          taskType: r.task_type ?? 'unknown',
          costRub: Math.round(rub * 100) / 100,
          calls: Number(r.calls),
        };
      }),
    };
  }

  async getOrg(tenantId: string, days: number) {
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    const fxRate = await this.fx.getCurrentUsdRubRate();
    const detail = await this.economics.computeForOrg(tenantId, fxRate);
    const cap = await this.prisma.orgBudgetCap.findUnique({
      where: { tenantId },
    });
    void days;
    return {
      tenantId,
      orgName: org.name,
      currencyRate: fxRate,
      ...detail,
      budget: cap
        ? {
            monthlyCapRub: cap.monthlyCapRub ? Number(cap.monthlyCapRub) : null,
            capKind: cap.capKind,
            alertThresholds: cap.alertThresholds,
            lastAlertAt: cap.lastAlertAt?.toISOString() ?? null,
            lastAlertThreshold: cap.lastAlertThreshold,
            utilizationPercent:
              cap.monthlyCapRub && Number(cap.monthlyCapRub) > 0
                ? (detail.costRubMonthToDate / Number(cap.monthlyCapRub)) * 100
                : null,
          }
        : null,
    };
  }

  async getBudgetCap(tenantId: string) {
    return this.prisma.orgBudgetCap.findUnique({ where: { tenantId } });
  }

  async upsertBudgetCap(
    tenantId: string,
    args: {
      monthlyCapRub: number | null;
      capKind: 'soft' | 'hard';
      alertThresholds: number[];
      setByUserId?: string;
    },
  ) {
    return this.prisma.orgBudgetCap.upsert({
      where: { tenantId },
      create: {
        tenantId,
        monthlyCapRub: args.monthlyCapRub != null ? args.monthlyCapRub.toFixed(2) : null,
        capKind: args.capKind,
        alertThresholds: args.alertThresholds,
        ...(args.setByUserId ? { setByUserId: args.setByUserId } : {}),
      },
      update: {
        monthlyCapRub: args.monthlyCapRub != null ? args.monthlyCapRub.toFixed(2) : null,
        capKind: args.capKind,
        alertThresholds: args.alertThresholds,
        ...(args.setByUserId ? { setByUserId: args.setByUserId } : {}),
        lastAlertThreshold: null,
      },
    });
  }
}
