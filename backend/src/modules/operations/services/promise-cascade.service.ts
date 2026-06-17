import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  isCommitmentOverdue,
  selectCascadeCritical,
  type CommitmentForCascade,
} from './promise-cascade.scoring';

@Injectable()
export class PromiseCascadeService {
  private readonly logger = new Logger(PromiseCascadeService.name);

  private static readonly WINDOW_DAYS = 60;
  private static readonly MAX_COMMITMENTS = 5_000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findCascadesForTenant(args: { tenantId: string; now: Date }): Promise<
    Array<{
      commitmentId: string;
      text: string;
      authorPersonId: string;
      authorName: string;
      recipientPersonId: string | null;
      recipientName: string | null;
      blockedGoalName: string | null;
      blockedIssueTitle: string | null;
    }>
  > {
    const since = new Date(args.now.getTime() - PromiseCascadeService.WINDOW_DAYS * 24 * 3_600_000);

    const commitments = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentStatus: { in: ['open', 'asked'] },
        commitmentAuthorPersonId: { not: null },
        commitmentDueDate: { lt: args.now, gte: since },
      },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        commitmentDueDate: true,
        commitmentStatus: true,
        commitmentAuthorPersonId: true,
        commitmentRecipientPersonId: true,
        commitmentAuthor: { select: { id: true, name: true } },
        commitmentRecipient: { select: { id: true, name: true, userId: true } },
      },
      take: PromiseCascadeService.MAX_COMMITMENTS,
    });
    if (commitments.length === 0) return [];

    const out: Array<{
      commitmentId: string;
      text: string;
      authorPersonId: string;
      authorName: string;
      recipientPersonId: string | null;
      recipientName: string | null;
      blockedGoalName: string | null;
      blockedIssueTitle: string | null;
    }> = [];

    const overdue = commitments.filter((c) =>
      isCommitmentOverdue({ dueDate: c.commitmentDueDate, status: c.commitmentStatus }, args.now),
    );

    const enriched: Array<{
      cascade: CommitmentForCascade;
      raw: (typeof overdue)[number];
      blockedGoalName: string | null;
      blockedIssueTitle: string | null;
    }> = [];

    for (const c of overdue) {
      const recipientPersonId = c.commitmentRecipientPersonId;
      let blockedGoalName: string | null = null;
      let blockedIssueTitle: string | null = null;

      if (recipientPersonId) {
        const goal = await this.prisma.goal.findFirst({
          where: {
            tenantId: args.tenantId,
            ownerPersonId: recipientPersonId,
            status: 'active',
          },
          select: { name: true },
          orderBy: { updatedAt: 'desc' },
        });
        if (goal) blockedGoalName = goal.name;

        if (!blockedGoalName && c.commitmentRecipient?.userId) {
          const assignee = await this.prisma.issueAssignee.findFirst({
            where: {
              userId: c.commitmentRecipient.userId,
              issue: {
                tenantId: args.tenantId,
                deletedAt: null,
                completedAt: null,
              },
            },
            select: { issue: { select: { title: true } } },
          });
          if (assignee?.issue) blockedIssueTitle = assignee.issue.title;
        }
      }

      enriched.push({
        cascade: {
          id: c.id,
          authorPersonId: c.commitmentAuthorPersonId,
          recipientPersonId,
          dueDate: c.commitmentDueDate,
          status: c.commitmentStatus,
          hasOutgoingDependency: blockedGoalName !== null || blockedIssueTitle !== null,
        },
        raw: c,
        blockedGoalName,
        blockedIssueTitle,
      });
    }

    const criticalIds = new Set(
      selectCascadeCritical(
        enriched.map((e) => e.cascade),
        args.now,
      ).map((c) => c.id),
    );

    for (const e of enriched) {
      if (!criticalIds.has(e.cascade.id)) continue;
      if (!e.raw.commitmentAuthor) continue;
      out.push({
        commitmentId: e.raw.id,
        text: (e.raw.name || e.raw.criticalQuestion || 'обещание').slice(0, 200),
        authorPersonId: e.raw.commitmentAuthor.id,
        authorName: e.raw.commitmentAuthor.name,
        recipientPersonId: e.raw.commitmentRecipient?.id ?? null,
        recipientName: e.raw.commitmentRecipient?.name ?? null,
        blockedGoalName: e.blockedGoalName,
        blockedIssueTitle: e.blockedIssueTitle,
      });
    }

    return out;
  }
}
