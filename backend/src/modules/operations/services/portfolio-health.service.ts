import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  PortfolioByPriorityDto,
  PortfolioHealthDto,
  PortfolioHealthRowDto,
  PortfolioPriorityKey,
} from '../dto/portfolio-health.dto';
import { PORTFOLIO_PRIORITY_KEYS } from '../dto/portfolio-health.dto';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import {
  classifyPortfolioLevel,
  computePortfolioHealth,
  DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS,
  DEFAULT_PORTFOLIO_HEALTH_WEIGHTS,
  emptyByStatus,
  GOAL_PROGRESS_STATUSES,
  type GoalProgressStatusKey,
  type PortfolioByStatus,
  type PortfolioHealthThresholds,
  type PortfolioHealthWeights,
} from './portfolio-health.scoring';

/**
 * ТЗ-2 Ф6.A (daily-value-dashboards) — PortfolioHealthService.
 *
 * Считает «здоровье портфеля целей» компании: распределение живых целей по
 * статусу движения (`progressStatus`) → интегральный балл 0..100, разрез по
 * MoSCoW-приоритету (`priority`) и построчный список целей с провенансом.
 *
 * Веса/пороги — AdminSetting через `getDynamic`, не код. Балл считает чистая
 * функция `computePortfolioHealth` (покрыта unit-тестами). Снимок upsert'ится
 * per (tenantId, dateLocal) — для дельты к прошлой неделе.
 *
 * Живая цель — `{ status:'active', promotionState:'active', validUntil:null,
 * archivedAt:null }` (тот же фильтр, что у director-dashboard «север компаса»).
 */
@Injectable()
export class PortfolioHealthService {
  private readonly logger = new Logger(PortfolioHealthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Построить (и записать) снимок здоровья портфеля за `dateLocal`. Считает на
   * лету; upsert per (tenantId, dateLocal) — идемпотентно. Возвращает DTO.
   */
  async compute(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<PortfolioHealthDto> {
    const { tenantId, dateLocal } = args;
    const tenantTop = resolveOperationsTenantTop(tenantId);

    const weights = await this.resolveWeights();
    const thresholds = await this.resolveThresholds();

    // Живые официальные цели компании (тот же фильтр, что и «север компаса»).
    const goals = await this.prisma.goal.findMany({
      where: {
        tenantId,
        status: 'active',
        promotionState: 'active',
        validUntil: null,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        progressStatus: true,
        priority: true,
        sourceBlockIds: true,
      },
      take: 5_000,
    });

    // 1. Разрез по статусу движения.
    const byStatus = emptyByStatus();
    for (const g of goals) {
      const st = g.progressStatus as GoalProgressStatusKey;
      if (GOAL_PROGRESS_STATUSES.includes(st)) byStatus[st] += 1;
    }

    // 2. Интегральный балл + уровень.
    const healthScore = computePortfolioHealth(byStatus, weights);
    const level = classifyPortfolioLevel(healthScore, thresholds);

    // 3. Разрез по MoSCoW-приоритету (+ корзина 'none' для null).
    const byPriority = this.buildByPriority(goals);

    // 4. Построчный список целей.
    const rows: PortfolioHealthRowDto[] = goals.map((g) => ({
      goalId: g.id,
      name: g.name,
      progressStatus: g.progressStatus,
      priority: (g.priority as PortfolioPriorityKey | null) ?? null,
      reason:
        g.sourceBlockIds.length > 0
          ? { sourceBlockId: g.sourceBlockIds[0]! }
          : null,
    }));

    // 5. Дельта к прошлой неделе ДО upsert текущего дня (берём предыдущий снимок
    //    строго раньше dateLocal — не путаем с только что записанным).
    const deltaVsPrevWeek = await this.computeDelta({
      tenantId,
      dateLocal,
      healthScore,
    });

    // 6. Upsert снимка (идемпотентно по (tenantId, dateLocal)).
    try {
      await this.prisma.portfolioHealthSnapshot.upsert({
        where: { tenantId_dateLocal: { tenantId, dateLocal } },
        create: {
          tenantId,
          dateLocal,
          healthScore,
          byStatusJson: byStatus as unknown as Prisma.InputJsonValue,
          byPriorityJson: byPriority as unknown as Prisma.InputJsonValue,
          goalsCount: goals.length,
        },
        update: {
          healthScore,
          byStatusJson: byStatus as unknown as Prisma.InputJsonValue,
          byPriorityJson: byPriority as unknown as Prisma.InputJsonValue,
          goalsCount: goals.length,
          snapshotAt: new Date(),
        },
        select: { id: true },
      });
      this.metrics.incPortfolioHealthSnapshot({ tenantTop });
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          tenantTop,
          dateLocal,
          err: err instanceof Error ? err.message : String(err),
        },
        'portfolio-health: upsert снимка упал (DTO всё равно вернём)',
      );
    }

    this.metrics.setPortfolioHealthScore({ tenantTop, score: healthScore });

    return {
      healthScore,
      scale: {
        healthy: thresholds.healthy,
        warning: thresholds.warning,
        level,
      },
      byStatus,
      byPriority,
      rows,
      deltaVsPrevWeek,
    };
  }

  // ──────────────────────────── helpers ───────────────────────────────

  /**
   * Разрез по MoSCoW-приоритету: для каждой корзины (must/should/could/wont +
   * 'none' для null) — count, achievedCount, achievedPercent.
   */
  private buildByPriority(
    goals: Array<{ priority: string | null; progressStatus: string }>,
  ): PortfolioByPriorityDto {
    const acc: PortfolioByPriorityDto = {
      must: emptyBucket(),
      should: emptyBucket(),
      could: emptyBucket(),
      wont: emptyBucket(),
      none: emptyBucket(),
    };
    for (const g of goals) {
      const key: PortfolioPriorityKey =
        g.priority && isPriorityKey(g.priority)
          ? (g.priority as PortfolioPriorityKey)
          : 'none';
      acc[key].count += 1;
      if (g.progressStatus === 'achieved') acc[key].achievedCount += 1;
    }
    for (const key of PORTFOLIO_PRIORITY_KEYS) {
      const b = acc[key];
      b.achievedPercent =
        b.count > 0 ? Math.round((b.achievedCount / b.count) * 100) : 0;
    }
    return acc;
  }

  /**
   * Дельта balla к самому свежему снимку строго раньше `dateLocal` (прошлая
   * неделя). null если предыдущего снимка нет (первый расчёт).
   */
  private async computeDelta(args: {
    tenantId: string;
    dateLocal: string;
    healthScore: number;
  }): Promise<number | null> {
    const prev = await this.prisma.portfolioHealthSnapshot.findFirst({
      where: { tenantId: args.tenantId, dateLocal: { lt: args.dateLocal } },
      orderBy: { dateLocal: 'desc' },
      select: { healthScore: true },
    });
    if (!prev) return null;
    return args.healthScore - prev.healthScore;
  }

  private async resolveWeights(): Promise<PortfolioHealthWeights> {
    const [achieved, on_track, at_risk, stalled, dropped] = await Promise.all([
      this.cfg.getDynamic<number>(
        'portfolio.health.weight_achieved',
        'PORTFOLIO_HEALTH_WEIGHT_ACHIEVED',
        DEFAULT_PORTFOLIO_HEALTH_WEIGHTS.achieved,
      ),
      this.cfg.getDynamic<number>(
        'portfolio.health.weight_on_track',
        'PORTFOLIO_HEALTH_WEIGHT_ON_TRACK',
        DEFAULT_PORTFOLIO_HEALTH_WEIGHTS.on_track,
      ),
      this.cfg.getDynamic<number>(
        'portfolio.health.weight_at_risk',
        'PORTFOLIO_HEALTH_WEIGHT_AT_RISK',
        DEFAULT_PORTFOLIO_HEALTH_WEIGHTS.at_risk,
      ),
      this.cfg.getDynamic<number>(
        'portfolio.health.weight_stalled',
        'PORTFOLIO_HEALTH_WEIGHT_STALLED',
        DEFAULT_PORTFOLIO_HEALTH_WEIGHTS.stalled,
      ),
      this.cfg.getDynamic<number>(
        'portfolio.health.weight_dropped',
        'PORTFOLIO_HEALTH_WEIGHT_DROPPED',
        DEFAULT_PORTFOLIO_HEALTH_WEIGHTS.dropped,
      ),
    ]);
    return { achieved, on_track, at_risk, stalled, dropped };
  }

  private async resolveThresholds(): Promise<PortfolioHealthThresholds> {
    const [healthy, warning] = await Promise.all([
      this.cfg.getDynamic<number>(
        'portfolio.health.threshold_healthy',
        'PORTFOLIO_HEALTH_THRESHOLD_HEALTHY',
        DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS.healthy,
      ),
      this.cfg.getDynamic<number>(
        'portfolio.health.threshold_warning',
        'PORTFOLIO_HEALTH_THRESHOLD_WARNING',
        DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS.warning,
      ),
    ]);
    return { healthy, warning };
  }
}

function emptyBucket() {
  return { count: 0, achievedCount: 0, achievedPercent: 0 };
}

function isPriorityKey(v: string): boolean {
  return v === 'must' || v === 'should' || v === 'could' || v === 'wont';
}

// Re-export для удобства тестов / эндпоинтов «пустого» состояния.
export { emptyByStatus, type PortfolioByStatus };
