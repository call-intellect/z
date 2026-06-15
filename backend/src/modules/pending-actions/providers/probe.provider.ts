import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ageDaysFrom,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
  type ProbePendingDetail,
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
        payload: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const overdue = i.expiresAt != null && i.expiresAt.getTime() < now.getTime();
      // payload probe.question формируется в ProbeDispatcherWorker:
      // { question, askedBy, context? } (см. probe-dispatcher.worker.ts §4).
      const payload = asObject(i.payload);
      const question = strOrUndef(payload.question);
      const context = strOrUndef(payload.context);
      const detail: ProbePendingDetail = {
        kind: 'probe',
        // Если по какой-то причине вопроса нет в payload — мягкий fallback.
        question: question ?? 'Уточняющий вопрос ждёт вашего ответа',
        context,
        notificationId: i.id,
      };
      return {
        source: this.source,
        resourceType: 'probe_question',
        resourceId: i.id,
        // Реальная суть: сам вопрос вместо шаблона.
        title: question ?? 'Уточняющий вопрос ждёт вашего ответа',
        severity: overdue ? 'urgent' : 'normal',
        ageDays,
        // Ведём прямо к конкретному вопросу в «Уведомлениях», где на него
        // можно ответить (ProbeAnswerInput), а не на общий список-ленту.
        // resourceId здесь = id Notification (см. select выше).
        actionUrl: `/me/notifications?id=${i.id}`,
        canQuickConfirm: false,
        detail,
      } satisfies PendingActionItem;
    });
  }
}

/** Безопасно приводит Prisma.JsonValue к объекту (иначе пустой объект). */
function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/** Непустая строка или undefined. */
function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
