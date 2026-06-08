import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';
import { BlockerSynthesisService } from '../services/blocker-synthesis.service';

import { yesterdayInMoscow } from './operations-daily-digest.cron';

/**
 * TZ-1 Фаза 3.A (daily-value-engine) — BlockerSynthesisCron.
 *
 * Глобальный `@Cron('0 22 * * *')` (после вечернего окна чек-инов): раз в день
 * обходит активные Org → `BlockerSynthesisService.computeForTenant` (накопление
 * блокеров за окно, статусы new|recurring|resolved, бизнес-удар, мост хроники в
 * Insight). Идемпотентность — upsert по (tenantId, clusterKey).
 *
 * Master-flag `operations.blocker_synthesis.enabled` (kill-switch, ON по
 * умолчанию). False → cron тикает, но сразу выходит.
 *
 * Метрики: `blocker_synthesis_recurring_total{status}` (в сервисе).
 */
@Injectable()
export class BlockerSynthesisCron {
  private readonly logger = new Logger(BlockerSynthesisCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BlockerSynthesisService)
    private readonly synth: BlockerSynthesisService,
  ) {}

  @Cron('0 22 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.blocker_synthesis.enabled',
      'OPERATIONS_BLOCKER_SYNTHESIS_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'blocker-synthesis.cron: operations.blocker_synthesis.enabled=false, skip',
      );
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.log(stats, 'blocker-synthesis.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'blocker-synthesis.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: можно передать произвольный `now`. */
  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    newClusters: number;
    recurringClusters: number;
    resolvedClusters: number;
    bridgedInsights: number;
    errors: number;
  }> {
    const dateLocal = yesterdayInMoscow(now);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let newClusters = 0;
    let recurringClusters = 0;
    let resolvedClusters = 0;
    let bridgedInsights = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      try {
        const res = await this.synth.computeForTenant({
          tenantId: org.id,
          dateLocal,
        });
        newClusters += res.newCount;
        recurringClusters += res.recurringCount;
        resolvedClusters += res.resolvedCount;
        bridgedInsights += res.bridgedInsights;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop,
            err: err instanceof Error ? err.message : String(err),
          },
          'blocker-synthesis.cron: computeForTenant упал для Org',
        );
      }
    }

    return {
      orgsProcessed: orgs.length,
      newClusters,
      recurringClusters,
      resolvedClusters,
      bridgedInsights,
      errors,
    };
  }
}
