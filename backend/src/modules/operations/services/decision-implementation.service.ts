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
  decisionStatusSortRank,
  decisionThroughputPercentForStatus,
  type DecisionImplementationStatus,
} from './decision-implementation.scoring';

/** Одно решение месяца со статусом доведения (для витрины Ф5). */
export interface MonthDecisionRow {
  id: string;
  statement: string;
  /** Статус внедрения (done/in_progress/stalled/not_started). */
  status: DecisionImplementationStatus;
  /** % доведения по статусу (done=100, in_progress=50, иначе 0). */
  throughputPercent: number;
}

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
    autoImplemented: number;
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
        status: true,
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
    let autoImplemented = 0;

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

      // Редизайн Ф8.1 — детерминированная петля решений: approved-решение,
      // доведённое до результата (есть actualOutcomes) ИЛИ под которым ВСЕ
      // связанные задачи закрыты → авто-перевод в статус 'implemented'.
      // Идемпотентно: после перехода status='implemented' условие (===approved)
      // не сработает повторно. Mention-based «сделали/внедрили» по транскриптам
      // НЕ делаем (LLM-эвристика) — закрывает основной кейс детерминированно.
      if (d.status === 'approved') {
        const doneByLoop =
          hasOutcomes ||
          (await this.allLinkedTasksCompleted({
            tenantId: args.tenantId,
            decisionId: d.id,
            linkedTaskCount: d.linkedTaskCount,
          }));
        if (doneByLoop) {
          await this.prisma.decision.update({
            where: { id: d.id },
            data: { status: 'implemented' },
          });
          autoImplemented++;
          this.metrics.incDecisionAutoImplemented();
          this.logger.log(
            { tenantId: args.tenantId, decisionId: d.id, reason: hasOutcomes ? 'outcomes' : 'all_tasks_done' },
            'decision-implementation: авто-переход approved→implemented',
          );
        }
      }

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

    return { checked, autoImplemented, stalled };
  }

  /**
   * Редизайн Ф8.1 — все ли связанные с решением задачи закрыты
   * (`Issue.completedAt != null`). Признак доведения для авто-перехода
   * approved→implemented. Требует ≥1 связанной задачи: решение без задач и
   * без outcomes доводить нельзя (иначе любое «голое» решение автозакроется).
   * `completedAt` — канон завершённости задачи (см. IssueOverdueDetectorCron),
   * не зависит от справочника IssueState.
   */
  private async allLinkedTasksCompleted(args: {
    tenantId: string;
    decisionId: string;
    linkedTaskCount: number;
  }): Promise<boolean> {
    if (args.linkedTaskCount <= 0) return false;
    const links = await this.prisma.decisionTaskLink.findMany({
      where: { decisionId: args.decisionId },
      select: { issue: { select: { completedAt: true } } },
      take: 1_000,
    });
    if (links.length === 0) return false;
    return links.every((l) => l.issue?.completedAt != null);
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

  /**
   * Список решений месяца со статусом доведения (для построчной витрины Ф5).
   * Окно [from, to] по decidedAt (fallback createdAt), статусы
   * approved/implemented. Статус доведения берётся из `implementationStatus`
   * (выставлен контролёром); если NULL — классифицируется на лету теми же
   * правилами. `throughputPercent` — грубая шкала по статусу (Р7: точный % —
   * только в агрегате getDecisionThroughput). Сортировка
   * done→in_progress→stalled→not_started, топ-N (default 10).
   */
  async listDecisionsForMonth(args: {
    tenantId: string;
    from: Date;
    to: Date;
    limit?: number;
    now?: Date;
  }): Promise<MonthDecisionRow[]> {
    const now = args.now ?? new Date();
    const staleDays = await this.resolveStaleDays();
    const rows = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        status: { in: [...DecisionImplementationService.CONTROLLED_STATUSES] },
        OR: [
          { decidedAt: { gte: args.from, lte: args.to } },
          { decidedAt: null, createdAt: { gte: args.from, lte: args.to } },
        ],
      },
      select: {
        id: true,
        statement: true,
        text: true,
        decidedAt: true,
        createdAt: true,
        linkedTaskCount: true,
        actualOutcomes: true,
        implementationStatus: true,
      },
      take: 5_000,
    });

    const mapped: MonthDecisionRow[] = rows.map((d) => {
      const status = this.resolveMonthDecisionStatus(d, staleDays, now);
      return {
        id: d.id,
        statement: (d.statement || d.text || 'Решение').slice(0, 200),
        status,
        throughputPercent: decisionThroughputPercentForStatus(status),
      };
    });

    mapped.sort(
      (a, b) => decisionStatusSortRank(a.status) - decisionStatusSortRank(b.status),
    );

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    return mapped.slice(0, limit);
  }

  /**
   * Статус доведения решения для списка месяца: берём `implementationStatus`
   * если он валиден, иначе классифицируем на лету (контролёр мог ещё не
   * прогнаться).
   */
  private resolveMonthDecisionStatus(
    d: {
      decidedAt: Date | null;
      createdAt: Date;
      linkedTaskCount: number;
      actualOutcomes: string | null;
      implementationStatus: string | null;
    },
    staleDays: number,
    now: Date,
  ): DecisionImplementationStatus {
    const stored = d.implementationStatus;
    if (
      stored === 'done' ||
      stored === 'in_progress' ||
      stored === 'stalled' ||
      stored === 'not_started'
    ) {
      return stored;
    }
    const ageDays = this.ageDays(d.decidedAt ?? d.createdAt, now);
    const hasOutcomes =
      typeof d.actualOutcomes === 'string' && d.actualOutcomes.trim().length > 0;
    return classifyImplementationStatus({
      ageDays,
      linkedTaskCount: d.linkedTaskCount,
      hasOutcomes,
      staleDays,
    });
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
