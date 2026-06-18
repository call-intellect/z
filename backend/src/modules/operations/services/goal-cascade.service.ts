import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class GoalCascadeService {
  private readonly logger = new Logger(GoalCascadeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async onChildCompleted(args: { tenantId: string; goalId: string }): Promise<string | null> {
    const goal = await this.prisma.goal.findUnique({
      where: { id: args.goalId },
      select: {
        id: true,
        tenantId: true,
        parentGoalId: true,
        status: true,
      },
    });
    if (!goal) return null;
    if (goal.tenantId !== args.tenantId) return null;
    if (!goal.parentGoalId) return null;
    if (goal.status !== 'achieved') return null;

    const parent = await this.prisma.goal.findUnique({
      where: { id: goal.parentGoalId },
      select: { id: true, status: true, tenantId: true },
    });
    if (!parent) return null;
    if (parent.tenantId !== args.tenantId) return null;
    if (parent.status !== 'active') return null;

    const siblings = await this.prisma.goal.findMany({
      where: {
        parentGoalId: parent.id,
        archivedAt: null,
      },
      select: { id: true, status: true },
    });
    if (siblings.length === 0) return null;
    const allAchieved = siblings.every((s) => s.status === 'achieved');
    if (!allAchieved) return null;

    await this.prisma.goal.update({
      where: { id: parent.id },
      data: { status: 'achieved' },
    });
    this.logger.log(
      { parentGoalId: parent.id, childCount: siblings.length },
      'goal-cascade: parent переведён в achieved (все children achieved)',
    );

    await this.onChildCompleted({
      tenantId: args.tenantId,
      goalId: parent.id,
    });
    return parent.id;
  }

  async onParentMissed(args: { tenantId: string; parentGoalId: string }): Promise<number> {
    const parent = await this.prisma.goal.findUnique({
      where: { id: args.parentGoalId },
      select: { id: true, status: true, tenantId: true },
    });
    if (!parent) return 0;
    if (parent.tenantId !== args.tenantId) return 0;
    if (parent.status !== 'abandoned') return 0;

    const now = new Date();
    const result = await this.prisma.goal.updateMany({
      where: {
        parentGoalId: parent.id,
        tenantId: args.tenantId,
        archivedAt: null,
        OR: [{ cascadeMissed: false }, { cascadeMissedFromGoalId: { not: parent.id } }],
      },
      data: {
        cascadeMissed: true,
        cascadeMissedFromGoalId: parent.id,
        cascadeMissedAt: now,
      },
    });

    if (result.count > 0) {
      this.metrics.incGoalCascadeMisses({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
        count: result.count,
      });
      this.logger.log(
        { parentGoalId: parent.id, affectedChildren: result.count },
        'goal-cascade: дети помечены cascadeMissed',
      );
    }

    return result.count;
  }
}
