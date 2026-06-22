import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ageDaysFrom,
  isPrivileged,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
  type TaskClosurePendingDetail,
} from './pending-actions-provider.types';

const DEFAULT_AUTO_CONFIRM_THRESHOLD = 0.95;

@Injectable()
export class TaskClosurePendingProvider implements PendingActionsProvider {
  readonly source = 'task_closure' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  private async scopedWhere(
    a: PendingActionsProviderArgs,
  ): Promise<Prisma.TaskClosureCandidateWhereInput> {
    const where: Prisma.TaskClosureCandidateWhereInput = {
      tenantId: a.tenantId,
      status: 'pending',
    };
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    if (!isPrivileged(a.role)) {
      const rows = await this.prisma.issueAssignee.findMany({
        where: { userId: a.userId },
        select: { issueId: true },
      });
      where.issueId = { in: rows.map((r) => r.issueId) };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    return this.prisma.taskClosureCandidate.count({
      where: await this.scopedWhere(a),
    });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    const items = await this.prisma.taskClosureCandidate.findMany({
      where: await this.scopedWhere(a),
      orderBy: [{ createdAt: 'asc' }],
      take: a.limit,
      select: {
        id: true,
        issueId: true,
        confidence: true,
        rationale: true,
        evidenceQuote: true,
        createdAt: true,
      },
    });

    // Батч-резолв заголовков задач (issueId → Issue.title) — один запрос.
    const issueIds = [...new Set(items.map((i) => i.issueId))];
    const titles = new Map<string, string>();
    if (issueIds.length > 0) {
      const issues = await this.prisma.issue.findMany({
        where: { id: { in: issueIds }, tenantId: a.tenantId },
        select: { id: true, title: true },
      });
      for (const iss of issues) titles.set(iss.id, iss.title);
    }

    const autoConfirmThreshold = await this.autoConfirmThreshold();
    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const taskTitle = titles.get(i.issueId) ?? 'Задача';
      const confidence =
        i.confidence != null ? Number(i.confidence.toString()) : undefined;
      const detail: TaskClosurePendingDetail = {
        kind: 'task_closure',
        taskTitle,
        rationale: i.rationale?.trim() || undefined,
        evidenceQuote: i.evidenceQuote?.trim() || undefined,
        confidence,
      };
      return {
        source: this.source,
        resourceType: 'task_closure_candidate',
        resourceId: i.id,
        title: `Похоже, выполнено: ${taskTitle}`,
        severity:
          ageDays >= this.cfg.pendingActions.urgentAgeDays
            ? 'urgent'
            : 'normal',
        ageDays,
        actionUrl: '/tracker',
        // Один клик, если верификатор уверен; всё равно подтверждает человек.
        canQuickConfirm:
          confidence != null && confidence >= autoConfirmThreshold,
        detail,
      } satisfies PendingActionItem;
    });
  }

  private async autoConfirmThreshold(): Promise<number> {
    const v = await this.cfg
      .getDynamic<number>(
        'taskClosure.autoConfirmThreshold',
        undefined,
        DEFAULT_AUTO_CONFIRM_THRESHOLD,
      )
      .catch(() => DEFAULT_AUTO_CONFIRM_THRESHOLD);
    return typeof v === 'number' && Number.isFinite(v)
      ? v
      : DEFAULT_AUTO_CONFIRM_THRESHOLD;
  }
}
