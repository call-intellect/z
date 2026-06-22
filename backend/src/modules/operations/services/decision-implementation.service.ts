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

export interface MonthDecisionRow {
  id: string;
  statement: string;
  status: DecisionImplementationStatus;
  throughputPercent: number;
}

@Injectable()
export class DecisionImplementationService {
  private readonly logger = new Logger(DecisionImplementationService.name);

  private static readonly CONTROLLED_STATUSES = ['approved', 'implemented'] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async computeForTenant(args: { tenantId: string; now: Date }): Promise<{
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
        deletedAt: null,
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
            {
              tenantId: args.tenantId,
              decisionId: d.id,
              reason: hasOutcomes ? 'outcomes' : 'all_tasks_done',
            },
            'decision-implementation: авто-переход approved→implemented',
          );
        }
      }

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

  async getDecisionThroughput(args: {
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<{ total: number; doneWithOutcomes: number; throughputPercent: number }> {
    const baseWhere: Prisma.DecisionWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
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
        deletedAt: null,
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

    mapped.sort((a, b) => decisionStatusSortRank(a.status) - decisionStatusSortRank(b.status));

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    return mapped.slice(0, limit);
  }

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
    const hasOutcomes = typeof d.actualOutcomes === 'string' && d.actualOutcomes.trim().length > 0;
    return classifyImplementationStatus({
      ageDays,
      linkedTaskCount: d.linkedTaskCount,
      hasOutcomes,
      staleDays,
    });
  }

  async listStalledForTenant(args: { tenantId: string; limit?: number }): Promise<
    Array<{
      id: string;
      statement: string;
      decidedAt: string | null;
      ageDays: number;
      implementationCheckedAt: string | null;
    }>
  > {
    const rows = await this.prisma.decision.findMany({
      where: { tenantId: args.tenantId, implementationStatus: 'stalled', deletedAt: null },
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
