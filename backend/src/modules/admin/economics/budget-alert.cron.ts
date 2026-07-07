import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';

import { CurrencyRateService } from './currency-rate.service';
import { OrgEconomicsCron } from './org-economics.cron';

@Injectable()
export class BudgetAlertCron {
  private readonly logger = new Logger(BudgetAlertCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(OrgEconomicsCron) private readonly economics: OrgEconomicsCron,
    @Inject(CurrencyRateService) private readonly fx: CurrencyRateService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 */2 * * *', { name: 'budget-alert' })
  async runScheduled(): Promise<void> {
    if (!this.cfg.budget.alertEnabled) {
      this.logger.debug('budget-alert: disabled by ENV');
      return;
    }
    try {
      const result = await this.runOnce();
      this.logger.debug(result, 'budget-alert.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'budget-alert.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(): Promise<{
    capsScanned: number;
    alertsSent: number;
  }> {
    const defaultCapRub =
      (await this.cfg.getDynamic<number>('llm.budget.default_monthly_cap_rub', undefined, 0)) ?? 0;
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const existingCaps = await this.prisma.orgBudgetCap.findMany();
    const capByTenant = new Map(existingCaps.map((c) => [c.tenantId, c]));
    const thresholds = [...this.cfg.budget.alertThresholdPercents].sort((a, b) => b - a);
    let alertsSent = 0;
    const fxRate = await this.fx.getCurrentUsdRubRate();

    for (const org of orgs) {
      try {
        const existing = capByTenant.get(org.id);
        const ownCapRub = existing?.monthlyCapRub != null ? Number(existing.monthlyCapRub) : null;
        const limit = ownCapRub ?? (defaultCapRub > 0 ? defaultCapRub : null);
        if (limit == null || !Number.isFinite(limit) || limit <= 0) continue;
        const effectiveCapKind = existing?.capKind ?? 'soft';

        const m = await this.economics.computeForOrg(org.id, fxRate);
        const utilization = (m.costRubMonthToDate / limit) * 100;
        const lastAlertAt = existing?.lastAlertAt ?? null;
        const isNewMonth =
          !lastAlertAt ||
          lastAlertAt.getUTCFullYear() !== new Date().getUTCFullYear() ||
          lastAlertAt.getUTCMonth() !== new Date().getUTCMonth();
        const lastThreshold = isNewMonth ? null : (existing?.lastAlertThreshold ?? null);

        let trigger: number | null = null;
        for (const t of thresholds) {
          if (utilization >= t && (lastThreshold == null || t > lastThreshold)) {
            trigger = t;
            break;
          }
        }
        if (trigger == null) continue;

        const owner = await this.prisma.membership.findFirst({
          where: { orgId: org.id, role: 'owner' },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true },
        });
        if (!owner) {
          this.logger.warn(
            { tenantId: org.id },
            'budget-alert: у тенанта нет owner — пропускаю',
          );
          continue;
        }

        const message =
          trigger >= 100
            ? effectiveCapKind === 'downgrade'
              ? `С сегодняшнего дня расходы компании на ИИ достигли месячного лимита ${limit} ₽ — включён экономный режим: до конца месяца AI-функции используют более простую модель.`
              : `Бюджет AI на месяц превышен (${Math.round(utilization)}% от лимита ${limit} ₽).`
            : `Бюджет AI на месяц использован на ${Math.round(utilization)}% (${Math.round(m.costRubMonthToDate)} ₽ из ${limit} ₽).`;

        await this.conversational.sendNotification({
          tenantId: org.id,
          recipientUserId: owner.userId,
          eventType: 'system.message',
          payload: {
            kind: 'budget_alert',
            threshold: trigger,
            utilization: Math.round(utilization * 10) / 10,
            limitRub: limit,
            costRubMonthToDate: Math.round(m.costRubMonthToDate),
            message,
          },
          dataClass: 'internal',
          critical: trigger >= 100,
        });

        await this.prisma.orgBudgetCap.upsert({
          where: { tenantId: org.id },
          create: {
            tenantId: org.id,
            monthlyCapRub: existing?.monthlyCapRub ?? null,
            capKind: effectiveCapKind,
            alertThresholds: existing?.alertThresholds ?? [50, 80, 95],
            lastAlertAt: new Date(),
            lastAlertThreshold: trigger,
          },
          update: {
            lastAlertAt: new Date(),
            lastAlertThreshold: trigger,
          },
        });
        this.metrics.incBudgetAlertSent(trigger);
        alertsSent++;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'budget-alert: ошибка для tenant — продолжаю',
        );
      }
    }

    return { capsScanned: orgs.length, alertsSent };
  }
}
