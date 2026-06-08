import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import {
  classifyImplementationStatus,
  computeDecisionThroughput,
  DEFAULT_DECISION_STALE_DAYS,
} from './decision-implementation.scoring';

/**
 * TZ-1 Фаза 3.B (daily-value-engine) — DecisionImplementationService.
 *
 * Контролёр внедрения решений: ловит `Decision(status∈approved/implemented)`
 * старше `decision.stale_days` (AdminSetting, default 21) с
 * `linkedTaskCount=0 AND actualOutcomes IS NULL` → `implementationStatus=
 * 'stalled'`. Строит агрегат «% решений, доведённых до actualOutcomes»
 * (несущая метрика витрины Ф5). БЕЗ LLM — чистый SQL/TS.
 */
@Injectable()
export class DecisionImplementationService {
  private readonly logger = new Logger(DecisionImplementationService.name);

  /** Статусы решений, которые контролируем на внедрение. */
  private static readonly CONTROLLED_STATUSES = ['approved', 'implemented'] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ──────────────────────────── compute (cron) ────────────────────────

  /**
   * Пройти по решениям Org, пересчитать `implementationStatus`. Возвращает
   * застрявшие решения (для пуша ответственным) + счётчики.
   * Идемпотентно (повторный прогон апдейтит те же статусы, не плодит).
   */
  async computeForTenant(args: {
    tenantId: string;
    now: Date;
  }): Promise<{
    checked: number;
    stalled: Array<{
      id: string;
      statement: string;
      decidedByPersonIds: string[];
    }>;
  }> {
    const staleDays = await this.resolveStaleDays();

    const decisions = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        status: { in: [...DecisionImplementationService.CONTROLLED_STATUSES] },
      },
      select: {
        id: true,
        statement: true,
        text: true,
        decidedByPersonIds: true,
        decidedAt: true,
        createdAt: true,
        linkedTaskCount: true,
        actualOutcomes: true,
        implementationStatus: true,
      },
      take: 10_000,
    });

    const stalled: Array<{
      id: string;
      statement: string;
      decidedByPersonIds: string[];
    }> = [];
    let checked = 0;

    for (const d of decisions) {
      const ageDays = this.ageDays(d.decidedAt ?? d.createdAt, args.now);
      const hasOutcomes =
        typeof d.actualOutcomes === 'string' && d.actualOutcomes.trim().length > 0;
      const status = classifyImplementationStatus({
        ageDays,
        linkedTaskCount: d.linkedTaskCount,
        hasOutcomes,
        staleDays,
      });

      // Апдейтим только при изменении (идемпотентность, меньше записей).
      if (status !== d.implementationStatus) {
        await this.prisma.decision.update({
          where: { id: d.id },
          data: {
            implementationStatus: status,
            implementationCheckedAt: args.now,
          },
        });
      } else {
        await this.prisma.decision.update({
          where: { id: d.id },
          data: { implementationCheckedAt: args.now },
        });
      }
      checked++;

      if (status === 'stalled') {
        // Метрика только на ПЕРЕХОД в stalled (не на каждый прогон).
        if (d.implementationStatus !== 'stalled') {
          this.metrics.incDecisionStalled();
        }
        stalled.push({
          id: d.id,
          statement: (d.statement || d.text || 'Решение').slice(0, 200),
          decidedByPersonIds: d.decidedByPersonIds ?? [],
        });
      }
    }

    // Обновляем gauge throughput (за последние 90 дней — операционное окно).
    try {
      const to = args.now;
      const from = new Date(to.getTime() - 90 * 24 * 3_600_000);
      const tp = await this.getDecisionThroughput({
        tenantId: args.tenantId,
        from,
        to,
      });
      this.metrics.setDecisionThroughputPercent({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
        value: tp.throughputPercent,
      });
    } catch (err) {
      this.logger.debug(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'decision-implementation: gauge throughput упал — пропускаю',
      );
    }

    return { checked, stalled };
  }

  // ──────────────────────────── read (endpoints / Ф5) ─────────────────

  /**
   * Агрегат «% решений, доведённых до actualOutcomes» за окно. Несущая метрика
   * витрины Ф5 (Р7 — count всегда в паре с «% доведённых»).
   *
   * `total` — решения, decidedAt/createdAt в [from, to] со статусом
   * approved/implemented; `doneWithOutcomes` — из них с непустым actualOutcomes.
   */
  async getDecisionThroughput(args: {
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<{ total: number; doneWithOutcomes: number; throughputPercent: number }> {
    const baseWhere: Prisma.DecisionWhereInput = {
      tenantId: args.tenantId,
      status: { in: [...DecisionImplementationService.CONTROLLED_STATUSES] },
      OR: [
        { decidedAt: { gte: args.from, lte: args.to } },
        { decidedAt: null, createdAt: { gte: args.from, lte: args.to } },
      ],
    };
    const [total, doneWithOutcomes] = await Promise.all([
      this.prisma.decision.count({ where: baseWhere }),
      this.prisma.decision.count({
        where: { ...baseWhere, actualOutcomes: { not: null } },
      }),
    ]);
    return computeDecisionThroughput({ total, doneWithOutcomes });
  }

  /** Решения без движения (`implementationStatus='stalled'`) — для endpoint'а. */
  async listStalledForTenant(args: {
    tenantId: string;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      statement: string;
      decidedAt: string | null;
      ageDays: number;
      implementationCheckedAt: string | null;
    }>
  > {
    const rows = await this.prisma.decision.findMany({
      where: { tenantId: args.tenantId, implementationStatus: 'stalled' },
      orderBy: [{ decidedAt: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(Math.max(args.limit ?? 50, 1), 100),
      select: {
        id: true,
        statement: true,
        text: true,
        decidedAt: true,
        createdAt: true,
        implementationCheckedAt: true,
      },
    });
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      statement: (r.statement || r.text || 'Решение').slice(0, 200),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      ageDays: this.ageDays(r.decidedAt ?? r.createdAt, now),
      implementationCheckedAt: r.implementationCheckedAt
        ? r.implementationCheckedAt.toISOString()
        : null,
    }));
  }

  // ──────────────────────────── helpers ───────────────────────────────

  private ageDays(from: Date, now: Date): number {
    const diff = Math.floor((now.getTime() - from.getTime()) / 86_400_000);
    return diff > 0 ? diff : 0;
  }

  private async resolveStaleDays(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'decision.stale_days',
      'DECISION_STALE_DAYS',
      DEFAULT_DECISION_STALE_DAYS,
    );
  }
}
