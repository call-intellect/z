import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ageDaysFrom,
  isPrivileged,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
} from './pending-actions-provider.types';

/**
 * Провайдер «входящая задача ждёт триажа» (IntakeIssue, status='pending').
 *
 * Кому показываем: только owner/admin Org (триаж inbox — их прерогатива).
 * Член без привилегий видит 0.
 *
 * severity=urgent, если карточка висит ≥ 5 дней. canQuickConfirm=false
 * (accept требует выбора проекта/полей — не «один клик»).
 */
@Injectable()
export class IntakePendingProvider implements PendingActionsProvider {
  readonly source = 'intake' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private buildWhere(
    a: PendingActionsProviderArgs,
  ): Prisma.IntakeIssueWhereInput {
    const where: Prisma.IntakeIssueWhereInput = {
      tenantId: a.tenantId,
      status: 'pending',
    };
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    if (!isPrivileged(a.role)) return 0;
    return this.prisma.intakeIssue.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    if (!isPrivileged(a.role)) return [];
    const items = await this.prisma.intakeIssue.findMany({
      where: this.buildWhere(a),
      orderBy: [{ createdAt: 'asc' }],
      take: a.limit,
      select: {
        id: true,
        extractedTitle: true,
        rawContent: true,
        createdAt: true,
      },
    });
    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const label =
        i.extractedTitle?.trim() || i.rawContent.slice(0, 80).trim();
      return {
        source: this.source,
        resourceType: 'intake_issue',
        resourceId: i.id,
        title: `Входящая задача: ${label}`,
        severity: ageDays >= 5 ? 'urgent' : 'normal',
        ageDays,
        actionUrl: '/intake',
        canQuickConfirm: false,
      } satisfies PendingActionItem;
    });
  }
}
