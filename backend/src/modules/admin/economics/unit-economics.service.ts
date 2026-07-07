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
      capKind: 'soft' | 'hard' | 'downgrade';
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
