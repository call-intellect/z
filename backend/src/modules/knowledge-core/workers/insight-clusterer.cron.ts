import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  DEFAULT_INSIGHT_RECHECK_DAYS,
  shouldReactivateInsight,
} from '../services/insight-recheck.scoring';
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
      let totalReactivated = 0;
      const recheckEnabled = await this.isRecheckEnabled();
      for (const org of orgs) {
        try {
          totalRecalc += await this.recalcAllForOrg(org.id);
          totalNoMitigation += await this.probes.checkNoMitigationPlanForOrg(
            org.id,
          );
          // TZ-1 Ф4.B — re-check митигированных инсайтов (повтор → active).
          if (recheckEnabled) {
            totalReactivated += await this.recheckMitigatedForOrg(org.id);
          }
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

      this.logger.debug(
        {
          orgs: orgs.length,
          totalRecalc,
          totalNoMitigation,
          totalReactivated,
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

  /**
   * TZ-1 Ф4.B — re-check митигированных инсайтов Org.
   *
   * Для каждого `Insight(status='mitigated')`:
   *   1. считаем сколько блоков-источников появилось ПОСЛЕ митигации
   *      (`createdAt > lastConfirmedAt`) — это свежие повторы паттерна;
   *   2. чистой функцией `shouldReactivateInsight` решаем, вернуть ли в active
   *      (прошло >= recheck_days и повтор есть);
   *   3. при reactivate → status='active', lastObservedAt=now.
   *
   * Возвращает число реактивированных. Не бросает на отдельном инсайте.
   */
  private async recheckMitigatedForOrg(tenantId: string): Promise<number> {
    const recheckDays = await this.cfg.getDynamic<number>(
      'insight.recheck_days',
      'INSIGHT_RECHECK_DAYS',
      DEFAULT_INSIGHT_RECHECK_DAYS,
    );
    const insights = await this.prisma.insight.findMany({
      where: { tenantId, status: 'mitigated' },
      select: {
        id: true,
        status: true,
        sourceBlockIds: true,
        lastConfirmedAt: true,
        lastObservedAt: true,
      },
      take: InsightClustererCron.BATCH_LIMIT,
    });
    const now = new Date();
    let reactivated = 0;
    for (const ins of insights) {
      try {
        if (ins.sourceBlockIds.length === 0) continue;
        // Свежие повторы = блоки-источники, созданные ПОСЛЕ митигации.
        const since = ins.lastConfirmedAt ?? ins.lastObservedAt;
        const recentRecurringBlockCount = await this.prisma.ideaBlock.count({
          where: {
            id: { in: ins.sourceBlockIds },
            tenantId,
            createdAt: { gt: since },
          },
        });
        const reactivate = shouldReactivateInsight(
          {
            status: ins.status,
            mitigatedAt: ins.lastConfirmedAt,
            lastObservedAt: ins.lastObservedAt,
            recentRecurringBlockCount,
          },
          now,
          recheckDays,
        );
        if (reactivate) {
          await this.prisma.insight.update({
            where: { id: ins.id },
            data: { status: 'active', lastObservedAt: now },
          });
          reactivated++;
          this.metrics.incInsightRechecked({ reactivated: true });
        } else {
          this.metrics.incInsightRechecked({ reactivated: false });
        }
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            insightId: ins.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'insight-clusterer.recheck: упал — пропускаю инсайт',
        );
      }
    }
    return reactivated;
  }

  private async isRecheckEnabled(): Promise<boolean> {
    return this.cfg.getDynamic<boolean>(
      'insights.recheck.enabled',
      'INSIGHTS_RECHECK_ENABLED',
      true,
    );
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
