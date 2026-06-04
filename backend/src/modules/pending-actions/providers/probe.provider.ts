import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ageDaysFrom,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
} from './pending-actions-provider.types';

/**
 * Провайдер «уточняющий вопрос ждёт ответа» (Notification
 * eventType='probe.question', responseStatus='pending').
 *
 * Кому показываем: получателю (recipientUserId = user) — любая роль.
 *
 * severity=urgent, если вопрос просрочен (expiresAt < now). canQuickConfirm=false
 * (probe требует свободного ответа текстом/голосом — не «один клик»).
 */
@Injectable()
export class ProbePendingProvider implements PendingActionsProvider {
  readonly source = 'probe' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private buildWhere(
    a: PendingActionsProviderArgs,
  ): Prisma.NotificationWhereInput {
    const where: Prisma.NotificationWhereInput = {
      tenantId: a.tenantId,
      recipientUserId: a.userId,
      eventType: 'probe.question',
      responseStatus: 'pending',
    };
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    return this.prisma.notification.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    const items = await this.prisma.notification.findMany({
      where: this.buildWhere(a),
      orderBy: [{ createdAt: 'asc' }],
      take: a.limit,
      select: {
        id: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const overdue = i.expiresAt != null && i.expiresAt.getTime() < now.getTime();
      return {
        source: this.source,
        resourceType: 'probe_question',
        resourceId: i.id,
        title: 'Уточняющий вопрос ждёт вашего ответа',
        severity: overdue ? 'urgent' : 'normal',
        ageDays,
        actionUrl: '/feed/probe-questions',
        canQuickConfirm: false,
      } satisfies PendingActionItem;
    });
  }
}
