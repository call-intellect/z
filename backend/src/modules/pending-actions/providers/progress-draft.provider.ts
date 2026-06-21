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
  type ProgressDraftPendingDetail,
} from './pending-actions-provider.types';

const PROGRESS_PREVIEW_MAX_CHARS = 160;

@Injectable()
export class ProgressDraftPendingProvider implements PendingActionsProvider {
  readonly source = 'progress_draft' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  private buildWhere(
    a: PendingActionsProviderArgs,
  ): Prisma.IssueProgressUpdateWhereInput {
    const where: Prisma.IssueProgressUpdateWhereInput = {
      tenantId: a.tenantId,
      draftState: 'pending',
      authorType: 'ai_agent',
      deletedAt: null,
    };
    // Видимость: owner/admin видят все черновики Org; остальные — только по
    // задачам, где они исполнители (прогресс адресован исполнителю).
    if (!isPrivileged(a.role)) {
      where.issue = { assignees: { some: { userId: a.userId } } };
    }
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    return this.prisma.issueProgressUpdate.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    const items = await this.prisma.issueProgressUpdate.findMany({
      where: this.buildWhere(a),
      orderBy: [{ createdAt: 'asc' }],
      take: a.limit,
      select: {
        id: true,
        issueId: true,
        health: true,
        body: true,
        evidenceQuote: true,
        confidence: true,
        createdAt: true,
      },
    });

    const issueIds = [...new Set(items.map((i) => i.issueId))];
    const titles = new Map<string, string>();
    if (issueIds.length > 0) {
      const issues = await this.prisma.issue.findMany({
        where: { id: { in: issueIds }, tenantId: a.tenantId },
        select: { id: true, title: true },
      });
      for (const iss of issues) titles.set(iss.id, iss.title);
    }

    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const taskTitle = titles.get(i.issueId) ?? 'Задача';
      const confidence =
        i.confidence != null ? Number(i.confidence.toString()) : undefined;
      const preview = this.previewOf(i.body);
      const detail: ProgressDraftPendingDetail = {
        kind: 'progress_draft',
        taskTitle,
        health: i.health,
        preview,
        evidenceQuote: i.evidenceQuote?.trim() || undefined,
        confidence,
      };
      return {
        source: this.source,
        resourceType: 'issue_progress_update',
        resourceId: i.id,
        title: `Кора собрала черновик прогресса: ${taskTitle}`,
        severity:
          ageDays >= this.cfg.pendingActions.urgentAgeDays
            ? 'urgent'
            : 'normal',
        ageDays,
        actionUrl: `/issues/${i.issueId}`,
        canQuickConfirm: true,
        detail,
      } satisfies PendingActionItem;
    });
  }

  private previewOf(body: string): string | undefined {
    const trimmed = body.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.length > PROGRESS_PREVIEW_MAX_CHARS
      ? `${trimmed.slice(0, PROGRESS_PREVIEW_MAX_CHARS).trimEnd()}…`
      : trimmed;
  }
}
