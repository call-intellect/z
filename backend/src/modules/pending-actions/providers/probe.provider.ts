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
    // ПРИМЕЧАНИЕ: count возвращает raw-количество из БД без дедупликации.
    // Это допустимое расхождение с listForUser (там дедуп в памяти):
    // count используется только для бейджика «число ожидающих» — небольшое
    // завышение безопаснее, чем сложный дедуп-запрос на уровне SQL.
    return this.prisma.notification.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    // Загружаем с запасом (limit*4, минимум 200), чтобы после дедупа в памяти
    // осталось достаточно элементов. Сортируем desc чтобы деdup оставлял НОВЫЕ.
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
        // contextBlockId / contextCardId — часть ключа дедупликации:
        // две нотификации с разным контекстом — РАЗНЫЕ вопросы.
        contextBlockId: true,
        contextCardId: true,
      },
    });

    // Дедупликация в памяти: группируем по ключу
    //   (contextBlockId|'_' + contextCardId|'_' + нормализованный вопрос).
    // Оставляем самую новую запись группы (уже отсортировано desc).
    // Ключ СТРОГИЙ: разный contextBlockId ИЛИ contextCardId ИЛИ разный вопрос
    // → разные элементы, схлопнуть нельзя.
    const deduped = deduplicateProbes(items);

    // Возвращаем в исходном порядке (asc по createdAt) — берём последние a.limit.
    const page = deduped
      .slice()
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
      .slice(0, a.limit);

    const now = new Date();
    return page.map((i) => {
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

/**
 * Дедупликация probe-уведомлений в памяти.
 *
 * Ключ группировки: `contextBlockId | '_' + contextCardId | '_' + normalizedQuestion`.
 * Это СТРОГИЙ ключ: два уведомления с разным contextBlockId, разным contextCardId
 * или разным вопросом (после нормализации) НЕ схлопнутся.
 *
 * Нормализация вопроса: lowercase + сжатие пробелов + обрезка (не делим по смыслу —
 * только убираем косметические дубли, порождённые разными форматами одного промпта).
 *
 * На входе items отсортированы по createdAt desc — первое вхождение в группе
 * (= самое новое) оставляем, остальные дропаем.
 */
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
    const question = typeof payload.question === 'string'
      ? payload.question.toLowerCase().replace(/\s+/g, ' ').trim()
      : '';
    const key = [
      item.contextBlockId ?? '_',
      item.contextCardId ?? '_',
      question,
    ].join('\x00');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
