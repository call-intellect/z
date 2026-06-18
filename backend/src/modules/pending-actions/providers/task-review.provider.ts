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
  type TaskReviewPendingDetail,
} from './pending-actions-provider.types';

/**
 * Провайдер «задача под вопросом ждёт проверки» (Issue с
 * `closureReviewState IS NOT NULL`) — TZ task-dedup 2026-06-16 Ф4 (Р4).
 *
 * Когда решение отменено/заменено (supersede), `specialist-3-3-decisions`
 * подсвечивает связанные через `DecisionTaskLink` задачи
 * (`closureReviewState='superseded_decision'`) — НЕ закрывая и НЕ отменяя их
 * (R11/R13). Здесь они показываются человеку: проверить актуальность и снять
 * пометку («разобрался») через confirm — `closureReviewState=null`.
 *
 * Кому показываем: только owner/admin Org (как intake-триаж — их прерогатива).
 * Член без привилегий видит 0.
 *
 * severity=urgent, если задача висит «под вопросом» ≥ cfg.pendingActions.urgentAgeDays
 * (отсчёт от closureReviewAt). canQuickConfirm=true — снятие пометки в один клик.
 */
@Injectable()
export class TaskReviewPendingProvider implements PendingActionsProvider {
  readonly source = 'task_review' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  private buildWhere(a: PendingActionsProviderArgs): Prisma.IssueWhereInput {
    const where: Prisma.IssueWhereInput = {
      tenantId: a.tenantId,
      closureReviewState: { not: null },
      deletedAt: null,
    };
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    if (!isPrivileged(a.role)) return 0;
    return this.prisma.issue.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    if (!isPrivileged(a.role)) return [];
    const items = await this.prisma.issue.findMany({
      where: this.buildWhere(a),
      orderBy: [{ closureReviewAt: 'asc' }],
      take: a.limit,
      select: {
        id: true,
        title: true,
        closureReviewReason: true,
        closureReviewAt: true,
        createdAt: true,
      },
    });

    const now = new Date();
    return items.map((i) => {
      // age от момента пометки (closureReviewAt), fallback на createdAt.
      const ageDays = ageDaysFrom(i.closureReviewAt ?? i.createdAt, now);
      const detail: TaskReviewPendingDetail = {
        kind: 'task_review',
        taskTitle: i.title,
        reason: i.closureReviewReason?.trim() || undefined,
      };
      return {
        source: this.source,
        resourceType: 'issue_review',
        resourceId: i.id,
        title: `Под вопросом: ${i.title}`,
        severity:
          ageDays >= this.cfg.pendingActions.urgentAgeDays
            ? 'urgent'
            : 'normal',
        ageDays,
        actionUrl: '/tracker',
        // Снятие пометки «разобрался» — один клик (необратимого действия нет:
        // задача и так не закрыта, просто гаснет подсветка).
        canQuickConfirm: true,
        detail,
      } satisfies PendingActionItem;
    });
  }
}
