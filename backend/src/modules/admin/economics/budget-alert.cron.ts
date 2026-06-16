import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';

import { CurrencyRateService } from './currency-rate.service';
import { OrgEconomicsCron } from './org-economics.cron';

/**
 * SBA α-10 wave 3 — BudgetAlertCron.
 *
 * Каждые 2 часа: для каждого OrgBudgetCap c monthlyCapRub > 0 — считает
 * текущий MTD-cost и triggerит alert при пересечении порогов из
 * cfg.budget.alertThresholdPercents (default [80, 100]).
 *
 * Anti-spam: запись `OrgBudgetCap.lastAlertThreshold` фиксирует последний
 * сработавший порог. Тот же порог повторно не алертит. Сброс — в начале
 * нового месяца (если lastAlertAt из прошлого месяца).
 *
 * jobId паттерн: `budget-alert_${tenantId}_${currentHourBucket}` — позволяет
 * рассмотреть переход на BullMQ jobId, чтобы 2 ноды backend'а не сделали
 * двойной alert. На MVP cron работает в одной реплике.
 *
 * Доставка через ConversationalService.sendNotification(eventType=
 * 'system.message'). По умолчанию policy = in_app + email_smtp.
 */
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
    const caps = await this.prisma.orgBudgetCap.findMany({
      where: { monthlyCapRub: { not: null } },
    });
    const thresholds = [...this.cfg.budget.alertThresholdPercents].sort(
      (a, b) => b - a, // от большего к меньшему — сработает только самый высокий
    );
    let alertsSent = 0;
    const fxRate = await this.fx.getCurrentUsdRubRate();

    for (const cap of caps) {
      try {
        const limit = Number(cap.monthlyCapRub);
        if (!Number.isFinite(limit) || limit <= 0) continue;

        const m = await this.economics.computeForOrg(cap.tenantId, fxRate);
        const utilization = (m.costRubMonthToDate / limit) * 100;
        // Сбрасываем lastAlertThreshold, если прошёл новый месяц.
        const lastAlertAt = cap.lastAlertAt;
        const isNewMonth =
          !lastAlertAt ||
          lastAlertAt.getUTCFullYear() !== new Date().getUTCFullYear() ||
          lastAlertAt.getUTCMonth() !== new Date().getUTCMonth();
        const lastThreshold = isNewMonth ? null : cap.lastAlertThreshold;

        // Находим самый высокий порог, который превышен И выше, чем
        // последний отправленный.
        let trigger: number | null = null;
        for (const t of thresholds) {
          if (utilization >= t && (lastThreshold == null || t > lastThreshold)) {
            trigger = t;
            break;
          }
        }
        if (trigger == null) continue;

        // Найти org-admin'ов (пока шлём первому owner'у; в γ+ — всем admin'ам).
        const owner = await this.prisma.membership.findFirst({
          where: { orgId: cap.tenantId, role: 'owner' },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true },
        });
        if (!owner) {
          this.logger.warn(
            { tenantId: cap.tenantId },
            'budget-alert: у тенанта нет owner — пропускаю',
          );
          continue;
        }

        await this.conversational.sendNotification({
          tenantId: cap.tenantId,
          recipientUserId: owner.userId,
          eventType: 'system.message',
          payload: {
            kind: 'budget_alert',
            threshold: trigger,
            utilization: Math.round(utilization * 10) / 10,
            limitRub: limit,
            costRubMonthToDate: Math.round(m.costRubMonthToDate),
            message:
              trigger >= 100
                ? `Бюджет AI на месяц превышен (${Math.round(utilization)}% от лимита ${limit} ₽).`
                : `Бюджет AI на месяц использован на ${Math.round(utilization)}% (${Math.round(m.costRubMonthToDate)} ₽ из ${limit} ₽).`,
          },
          dataClass: 'internal',
          critical: trigger >= 100,
        });

        await this.prisma.orgBudgetCap.update({
          where: { id: cap.id },
          data: {
            lastAlertAt: new Date(),
            lastAlertThreshold: trigger,
          },
        });
        this.metrics.incBudgetAlertSent(trigger);
        alertsSent++;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: cap.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'budget-alert: ошибка для tenant — продолжаю',
        );
      }
    }

    return { capsScanned: caps.length, alertsSent };
  }
}
