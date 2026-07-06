import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ageDaysFrom,
  type IntakePendingDetail,
  isPrivileged,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
} from './pending-actions-provider.types';

const MIN_INTAKE_CONFIDENCE = 0.3;

@Injectable()
export class IntakePendingProvider implements PendingActionsProvider {
  readonly source = 'intake' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  private buildWhere(a: PendingActionsProviderArgs): Prisma.IntakeIssueWhereInput {
    const where: Prisma.IntakeIssueWhereInput = {
      tenantId: a.tenantId,
      status: 'pending',
      OR: [{ confidence: null }, { confidence: { gte: MIN_INTAKE_CONFIDENCE } }],
    };
    if (!isPrivileged(a.role)) {
      where.suggestedAssigneeId = a.userId;
    }
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    return this.prisma.intakeIssue.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    const items = await this.prisma.intakeIssue.findMany({
      where: this.buildWhere(a),
      orderBy: [{ createdAt: 'asc' }],
      take: a.limit,
      select: {
        id: true,
        extractedTitle: true,
        extractedDescription: true,
        rawContent: true,
        suggestedAssigneeId: true,
        suggestedDueDate: true,
        confidence: true,
        createdAt: true,
      },
    });

    const assigneeUserIds = [
      ...new Set(items.map((i) => i.suggestedAssigneeId).filter((v): v is string => !!v)),
    ];
    const assigneeNames = new Map<string, string>();
    if (assigneeUserIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { userId: { in: assigneeUserIds }, tenantId: a.tenantId },
        select: { userId: true, name: true },
      });
      for (const p of persons) if (p.userId) assigneeNames.set(p.userId, p.name);
    }

    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const label = i.extractedTitle?.trim() || i.rawContent.slice(0, 80).trim();
      const detail: IntakePendingDetail = {
        kind: 'intake',
        title: label,
        description: i.extractedDescription?.trim() || undefined,
        assigneeName: i.suggestedAssigneeId ? assigneeNames.get(i.suggestedAssigneeId) : undefined,
        dueLabel: i.suggestedDueDate?.toISOString() ?? undefined,
        confidence: i.confidence != null ? Number(i.confidence.toString()) : undefined,
      };
      return {
        source: this.source,
        resourceType: 'intake_issue',
        resourceId: i.id,
        title: label,
        severity: ageDays >= this.cfg.pendingActions.urgentAgeDays ? 'urgent' : 'normal',
        ageDays,
        actionUrl: '/intake',
        canQuickConfirm: false,
        detail,
      } satisfies PendingActionItem;
    });
  }
}
