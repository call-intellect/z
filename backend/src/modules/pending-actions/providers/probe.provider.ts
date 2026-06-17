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

@Injectable()
export class ProbePendingProvider implements PendingActionsProvider {
  readonly source = 'probe' as const;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private buildWhere(a: PendingActionsProviderArgs): Prisma.NotificationWhereInput {
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
    const fetchLimit = Math.max(a.limit * 4, 200);
    const items = await this.prisma.notification.findMany({
      where: this.buildWhere(a),
      orderBy: [{ createdAt: 'desc' }],
      take: fetchLimit,
      select: {
        id: true,
        payload: true,
        expiresAt: true,
        createdAt: true,
        contextBlockId: true,
        contextCardId: true,
      },
    });

    const deduped = deduplicateProbes(items);

    const page = deduped
      .slice()
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .slice(0, a.limit);

    const now = new Date();
    return page.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const overdue = i.expiresAt != null && i.expiresAt.getTime() < now.getTime();
      const payload = asObject(i.payload);
      const question = strOrUndef(payload.question);
      const context = strOrUndef(payload.context);
      const detail: ProbePendingDetail = {
        kind: 'probe',
        question: question ?? 'Уточняющий вопрос ждёт вашего ответа',
        context,
        notificationId: i.id,
      };
      return {
        source: this.source,
        resourceType: 'probe_question',
        resourceId: i.id,
        title: question ?? 'Уточняющий вопрос ждёт вашего ответа',
        severity: overdue ? 'urgent' : 'normal',
        ageDays,
        actionUrl: `/me/notifications?id=${i.id}`,
        canQuickConfirm: false,
        detail,
      } satisfies PendingActionItem;
    });
  }
}

function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

function deduplicateProbes<
  T extends {
    id: string;
    payload: unknown;
    expiresAt: Date | null;
    contextBlockId: string | null;
    contextCardId: string | null;
    createdAt: Date;
  },
>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const payload = asObject(item.payload);
    const question =
      typeof payload.question === 'string'
        ? payload.question.toLowerCase().replace(/\s+/g, ' ').trim()
        : '';
    const key = [item.contextBlockId ?? '_', item.contextCardId ?? '_', question].join('\x00');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
