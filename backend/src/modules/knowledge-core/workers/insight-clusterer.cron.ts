import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist35Service } from '../services/specialist-3-5-insights.service';
import { Specialist35ProbeService } from '../services/specialist-3-5-probe.service';

/**
 * SBA β-4 — InsightClustererCron.
 *
 * Раз в N часов (по умолчанию — 0 *‎/6 * * *, см. INSIGHT_CLUSTER_CRON):
 *   1. Для каждой активной Org для каждого active Insight'а вызывает
 *      `Specialist35Service.recalcMetrics` — пересчёт frequencyScore /
 *      dynamicScore / dynamicLabel.
 *   2. Когда новый dynamicLabel='spike' и старый != 'spike' — внутри
 *      recalcMetrics эмиттится probe `insight.escalation_suggested`.
 *   3. Прогоняет `Specialist35ProbeService.checkNoMitigationPlanForOrg` —
 *      probe `insight.no_mitigation_plan` для high/critical Insight'ов без
 *      mitigationPlan и age > 7 дней.
 *   4. Обновляет gauge `insights_dynamic_label_count{label}` — текущее
 *      распределение Insight'ов по dynamicLabel.
 *
 * Контракт: НЕ бросает. Ошибка в одной Org не валит остальные.
 *
 * NB: cron-выражение в декораторе литерально (NestJS @Cron не поддерживает
 * env-driven строки). Если в ENV `INSIGHT_CLUSTER_CRON` отличается от
 * дефолта — заменить декоратор и пересобрать.
 */
@Injectable()
export class InsightClustererCron {
  private readonly logger = new Logger(InsightClustererCron.name);
  /** Лимит Insight'ов на проход в одной Org (защита от взрывного fan-out'а). */
  private static readonly BATCH_LIMIT = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(Specialist35Service) private readonly svc: Specialist35Service,
    @Inject(Specialist35ProbeService)
    private readonly probes: Specialist35ProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 */6 * * *')
  async sweep(): Promise<void> {
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let totalRecalc = 0;
      let totalNoMitigation = 0;
      for (const org of orgs) {
        try {
          totalRecalc += await this.recalcAllForOrg(org.id);
          totalNoMitigation += await this.probes.checkNoMitigationPlanForOrg(
            org.id,
          );
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'insight-clusterer: ошибка обработки Org — пропускаю',
          );
        }
      }

      // Глобальный gauge insights_dynamic_label_count{label}.
      await this.refreshDynamicLabelGauge();

      this.logger.log(
        {
          orgs: orgs.length,
          totalRecalc,
          totalNoMitigation,
          clusterCron: this.cfg.insights.clusterCron,
        },
        'insight-clusterer: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'insight-clusterer: непойманная ошибка',
      );
    }
  }

  private async recalcAllForOrg(tenantId: string): Promise<number> {
    const insights = await this.prisma.insight.findMany({
      where: { tenantId, status: { in: ['active', 'mitigating'] } },
      select: { id: true },
      take: InsightClustererCron.BATCH_LIMIT,
    });
    let processed = 0;
    for (const ins of insights) {
      try {
        await this.svc.recalcMetrics({ insightId: ins.id });
        processed += 1;
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            insightId: ins.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'insight-clusterer.recalcMetrics: упал — пропускаю Insight',
        );
      }
    }
    return processed;
  }

  /**
   * Глобальный gauge — сколько активных Insight'ов сейчас в каждом dynamicLabel.
   * Простой groupBy. labels: growing | stable | declining | spike.
   */
  private async refreshDynamicLabelGauge(): Promise<void> {
    try {
      const labels = ['growing', 'stable', 'declining', 'spike'] as const;
      // groupBy на active+mitigating Insights, агрегация по dynamicLabel.
      const grouped = await this.prisma.insight.groupBy({
        by: ['dynamicLabel'],
        where: { status: { in: ['active', 'mitigating'] } },
        _count: { _all: true },
      });
      const counts = new Map<string, number>();
      for (const g of grouped) {
        counts.set(g.dynamicLabel, g._count._all);
      }
      for (const label of labels) {
        this.metrics.setInsightsDynamicLabelCount({
          label,
          value: counts.get(label) ?? 0,
        });
      }
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'insight-clusterer.refreshDynamicLabelGauge: упал — пропускаю gauge',
      );
    }
  }
}
