/**
 * FeedbackTopicManagerService — операции super-admin'а над блоками:
 *   - listTopics:   агрегированный список с метриками за окно;
 *   - getTopic:     детали блока;
 *   - listItems:    items блока с информацией об авторе и Org;
 *   - getItemMessage: исходное FeedbackMessage по item.id;
 *   - rename:       PATCH title + description;
 *   - merge:        перенос items source → target в транзакции;
 *   - archive / unarchive: переключение status.
 *
 * Реализация — Фаза 6.
 *
 * ОСНОВНОЙ АЛГОРИТМ ПОДСЧЁТА АГРЕГАТОВ (важно для Phase 7 на frontend):
 *   1. Окно (window=30|90|all) — фильтр по `FeedbackItem.createdAt >= since`.
 *      Для `all` фильтр выключен.
 *   2. `totalItemsInWindow` = `count(FeedbackItem WHERE discarded=false AND
 *      createdAt >= since)`.
 *   3. `itemsCount` (на блок) — `count(FeedbackItem WHERE topicId AND ...)`,
 *      считаем через `groupBy(topicId)` одним запросом.
 *   4. `uniqueUsersCount` — `count(DISTINCT FeedbackMessage.userId)` среди
 *      items блока в окне. Реализован через raw SQL с JOIN на FeedbackMessage,
 *      т.к. Prisma groupBy не поддерживает `_count: { userId: { distinct } }`
 *      по связанной таблице.
 *   5. `lastItemAt` — `max(createdAt)` items в окне (groupBy `_max`).
 *   6. `percentOfWindow` = `(itemsCount / totalItemsInWindow) * 100`,
 *      с точностью 1 знак после запятой; 0 если total=0.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md
 * раздел «Админские эндпоинты».
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FeedbackTopicStatus, type Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  FeedbackItemMessageResponse,
  FeedbackItemsListResponse,
} from '../dto/feedback-item.dto';
import type { MergeTopicsBody } from '../dto/merge-topics.dto';
import type { RenameTopicBody } from '../dto/rename-topic.dto';
import type {
  FeedbackTopicWindow,
  TopicListFilters,
} from '../dto/topic-list-filters.dto';
import type {
  FeedbackTopicDetail,
  FeedbackTopicSummary,
  FeedbackTopicsListResponse,
} from '../dto/feedback-topic.dto';

@Injectable()
export class FeedbackTopicManagerService {
  private readonly logger = new Logger(FeedbackTopicManagerService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ──────────────────────────── list/details ────────────────────────────

  /**
   * Список блоков с агрегатами за выбранное окно.
   *
   * Состоит из 4 SQL-запросов:
   *   1. Базовый список топиков (с фильтром по q/status, сортировка позже).
   *   2. `groupBy` по `FeedbackItem.topicId` — itemsCount + lastItemAt.
   *   3. Raw SQL — uniqueUsersCount по topicId через JOIN на FeedbackMessage.
   *   4. `totalItemsInWindow` — count items в окне.
   *
   * Сортировка и пагинация выполняются в JS после агрегации, потому что
   * сортировать в SQL по `percent/users/recent` через Prisma неудобно
   * (агрегаты живут в отдельной таблице). Это допустимо: блоков ожидается
   * максимум сотни, не тысячи.
   */
  async listTopics(
    filters: TopicListFilters,
  ): Promise<FeedbackTopicsListResponse> {
    const since = windowSince(filters.window);

    // 1. Подбираем топики с фильтром по q/status. MERGED исключаем всегда.
    const allowedStatuses: FeedbackTopicStatus[] = filters.includeArchived
      ? [FeedbackTopicStatus.ACTIVE, FeedbackTopicStatus.ARCHIVED]
      : [FeedbackTopicStatus.ACTIVE];

    const where: Prisma.FeedbackTopicWhereInput = {
      status: { in: allowedStatuses },
    };
    if (filters.q && filters.q.length > 0) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { description: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const topics = await this.prisma.feedbackTopic.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
      },
    });
    const topicIds = topics.map((t) => t.id);

    // 2. Агрегаты по items.
    const itemsAggregates = await this.aggregateItemsByTopic(topicIds, since);

    // 3. Total items в окне (для percentOfWindow).
    const totalItemsInWindow = await this.countTotalItemsInWindow(since);

    // 4. Уникальные пользователи на окно (общая метрика).
    const totalUsersInWindow = await this.countTotalUsersInWindow(since);

    // 5. Сборка summary-строк.
    const summaries: FeedbackTopicSummary[] = topics.map((t) => {
      const agg = itemsAggregates.get(t.id) ?? {
        itemsCount: 0,
        uniqueUsersCount: 0,
        lastItemAt: null,
      };
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        itemsCount: agg.itemsCount,
        uniqueUsersCount: agg.uniqueUsersCount,
        percentOfWindow: percentOf(agg.itemsCount, totalItemsInWindow),
        lastItemAt: agg.lastItemAt ? agg.lastItemAt.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
      };
    });

    // 6. Сортировка.
    summaries.sort((a, b) => compareTopics(a, b, filters.sort));

    // 7. Пагинация в JS.
    const totalTopicsInWindow = summaries.length;
    const start = (filters.page - 1) * filters.pageSize;
    const paged = summaries.slice(start, start + filters.pageSize);

    return {
      items: paged,
      totalItemsInWindow,
      totalUsersInWindow,
      totalTopicsInWindow,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  /**
   * Детали одного блока + те же агрегаты по выбранному окну.
   */
  async getTopic(
    id: string,
    window: FeedbackTopicWindow,
  ): Promise<FeedbackTopicDetail> {
    const topic = await this.prisma.feedbackTopic.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        mergedIntoId: true,
      },
    });
    if (!topic) {
      throw new NotFoundException(`FeedbackTopic ${id} не найден`);
    }

    const since = windowSince(window);
    const [itemsAgg, totalItemsInWindow] = await Promise.all([
      this.aggregateItemsByTopic([id], since),
      this.countTotalItemsInWindow(since),
    ]);
    const agg = itemsAgg.get(id) ?? {
      itemsCount: 0,
      uniqueUsersCount: 0,
      lastItemAt: null,
    };

    return {
      id: topic.id,
      title: topic.title,
      description: topic.description,
      status: topic.status,
      itemsCount: agg.itemsCount,
      uniqueUsersCount: agg.uniqueUsersCount,
      percentOfWindow: percentOf(agg.itemsCount, totalItemsInWindow),
      lastItemAt: agg.lastItemAt ? agg.lastItemAt.toISOString() : null,
      createdAt: topic.createdAt.toISOString(),
      archivedAt: topic.archivedAt ? topic.archivedAt.toISOString() : null,
      updatedAt: topic.updatedAt.toISOString(),
      mergedIntoId: topic.mergedIntoId,
    };
  }

  /**
   * Items блока (тезисы) с автором, Org и messageId.
   * Сортировка по createdAt desc.
   */
  async listItems(
    topicId: string,
    page: number,
    pageSize: number,
  ): Promise<FeedbackItemsListResponse> {
    // Сначала проверим что блок существует — даём 404 а не пустую страницу.
    const topic = await this.prisma.feedbackTopic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });
    if (!topic) {
      throw new NotFoundException(`FeedbackTopic ${topicId} не найден`);
    }

    const skip = (page - 1) * pageSize;
    const where: Prisma.FeedbackItemWhereInput = {
      topicId,
      discarded: false,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.feedbackItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          text: true,
          createdAt: true,
          messageId: true,
          discarded: true,
          discardReason: true,
          message: {
            select: {
              user: {
                select: { id: true, email: true, name: true },
              },
              org: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
      this.prisma.feedbackItem.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        messageId: r.messageId,
        discarded: r.discarded,
        discardReason: r.discardReason,
        user: {
          id: r.message.user.id,
          email: r.message.user.email,
          name: r.message.user.name,
        },
        org: r.message.org
          ? { id: r.message.org.id, name: r.message.org.name }
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Исходное FeedbackMessage по item.id. Возвращает полный текст для
   * «развёртки строки» в админ-UI.
   */
  async getItemMessage(
    topicId: string,
    itemId: string,
  ): Promise<FeedbackItemMessageResponse> {
    const item = await this.prisma.feedbackItem.findUnique({
      where: { id: itemId },
      select: {
        topicId: true,
        message: {
          select: {
            id: true,
            text: true,
            createdAt: true,
            userId: true,
            orgId: true,
            user: { select: { id: true, email: true, name: true } },
            org: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!item) {
      throw new NotFoundException(`FeedbackItem ${itemId} не найден`);
    }
    // Защита от race-condition / неправильного URL — item должен принадлежать
    // именно этому topic (или быть в этом topic'е до merge'а).
    if (item.topicId !== topicId) {
      throw new NotFoundException(
        `FeedbackItem ${itemId} не принадлежит блоку ${topicId}`,
      );
    }

    const msg = item.message;
    return {
      id: msg.id,
      text: msg.text,
      createdAt: msg.createdAt.toISOString(),
      userId: msg.userId,
      orgId: msg.orgId,
      user: {
        id: msg.user.id,
        email: msg.user.email,
        name: msg.user.name,
      },
      org: msg.org ? { id: msg.org.id, name: msg.org.name } : null,
    };
  }

  // ──────────────────────────── mutations ────────────────────────────

  /**
   * PATCH title + description блока. Только ACTIVE/ARCHIVED, не MERGED.
   */
  async rename(
    id: string,
    body: RenameTopicBody,
  ): Promise<FeedbackTopicDetail> {
    const existing = await this.prisma.feedbackTopic.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      throw new NotFoundException(`FeedbackTopic ${id} не найден`);
    }
    if (existing.status === FeedbackTopicStatus.MERGED) {
      throw new BadRequestException(
        'Нельзя переименовать блок в статусе MERGED',
      );
    }

    await this.prisma.feedbackTopic.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
      },
    });

    this.logger.log(
      { topicId: id, newTitle: body.title },
      'feedback-admin.rename: блок переименован',
    );

    return this.getTopic(id, '30');
  }

  /**
   * Объединение source → target. В транзакции:
   *   1. Переносим items source → target.
   *   2. source.status = MERGED, mergedIntoId = target.id.
   *
   * Валидации:
   *   - source != target
   *   - target существует и не в MERGED
   *   - source существует и не в MERGED
   */
  async merge(
    sourceId: string,
    body: MergeTopicsBody,
  ): Promise<{ movedItems: number; mergedIntoId: string }> {
    const { targetId } = body;
    if (sourceId === targetId) {
      throw new BadRequestException(
        'Нельзя объединить блок с самим собой',
      );
    }

    const [source, target] = await Promise.all([
      this.prisma.feedbackTopic.findUnique({
        where: { id: sourceId },
        select: { id: true, status: true },
      }),
      this.prisma.feedbackTopic.findUnique({
        where: { id: targetId },
        select: { id: true, status: true },
      }),
    ]);
    if (!source) {
      throw new NotFoundException(`Source FeedbackTopic ${sourceId} не найден`);
    }
    if (!target) {
      throw new NotFoundException(`Target FeedbackTopic ${targetId} не найден`);
    }
    if (source.status === FeedbackTopicStatus.MERGED) {
      throw new BadRequestException(
        'Source-блок уже в статусе MERGED — повторное объединение запрещено',
      );
    }
    if (target.status === FeedbackTopicStatus.MERGED) {
      throw new BadRequestException(
        'Target-блок в статусе MERGED — выберите активный target',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.feedbackItem.updateMany({
        where: { topicId: sourceId },
        data: { topicId: targetId },
      });
      await tx.feedbackTopic.update({
        where: { id: sourceId },
        data: {
          status: FeedbackTopicStatus.MERGED,
          mergedIntoId: targetId,
        },
      });
      return { movedItems: moved.count };
    });

    this.logger.log(
      {
        sourceId,
        targetId,
        movedItems: result.movedItems,
      },
      'feedback-admin.merge: блоки объединены',
    );

    return { movedItems: result.movedItems, mergedIntoId: targetId };
  }

  /**
   * Перевод блока в ARCHIVED (только из ACTIVE).
   */
  async archive(id: string): Promise<FeedbackTopicDetail> {
    const existing = await this.prisma.feedbackTopic.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      throw new NotFoundException(`FeedbackTopic ${id} не найден`);
    }
    if (existing.status !== FeedbackTopicStatus.ACTIVE) {
      throw new BadRequestException(
        `Архивировать можно только ACTIVE-блок (текущий: ${existing.status})`,
      );
    }

    await this.prisma.feedbackTopic.update({
      where: { id },
      data: {
        status: FeedbackTopicStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });

    this.logger.log({ topicId: id }, 'feedback-admin.archive: блок архивирован');
    return this.getTopic(id, '30');
  }

  /**
   * Возврат блока из ARCHIVED → ACTIVE.
   */
  async unarchive(id: string): Promise<FeedbackTopicDetail> {
    const existing = await this.prisma.feedbackTopic.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      throw new NotFoundException(`FeedbackTopic ${id} не найден`);
    }
    if (existing.status !== FeedbackTopicStatus.ARCHIVED) {
      throw new BadRequestException(
        `Восстановить можно только ARCHIVED-блок (текущий: ${existing.status})`,
      );
    }

    await this.prisma.feedbackTopic.update({
      where: { id },
      data: {
        status: FeedbackTopicStatus.ACTIVE,
        archivedAt: null,
      },
    });

    this.logger.log(
      { topicId: id },
      'feedback-admin.unarchive: блок восстановлен из архива',
    );
    return this.getTopic(id, '30');
  }

  // ──────────────────────────── helpers ────────────────────────────

  /**
   * Агрегаты items по topic'ам:
   *   - itemsCount (count items с discarded=false в окне)
   *   - uniqueUsersCount (distinct FeedbackMessage.userId)
   *   - lastItemAt (max createdAt)
   *
   * itemsCount + lastItemAt — через `groupBy`.
   * uniqueUsersCount — через raw SQL (Prisma groupBy не умеет
   * `count distinct` по связанному столбцу).
   */
  private async aggregateItemsByTopic(
    topicIds: string[],
    since: Date | null,
  ): Promise<
    Map<
      string,
      {
        itemsCount: number;
        uniqueUsersCount: number;
        lastItemAt: Date | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        itemsCount: number;
        uniqueUsersCount: number;
        lastItemAt: Date | null;
      }
    >();
    if (topicIds.length === 0) return result;

    const itemWhere: Prisma.FeedbackItemWhereInput = {
      topicId: { in: topicIds },
      discarded: false,
    };
    if (since !== null) {
      itemWhere.createdAt = { gte: since };
    }

    const grouped = await this.prisma.feedbackItem.groupBy({
      by: ['topicId'],
      where: itemWhere,
      _count: { _all: true },
      _max: { createdAt: true },
    });

    for (const row of grouped) {
      if (row.topicId === null) continue;
      result.set(row.topicId, {
        itemsCount: row._count._all,
        uniqueUsersCount: 0, // заполним ниже
        lastItemAt: row._max.createdAt,
      });
    }

    // Уникальные авторы — raw SQL, чтобы DISTINCT по FeedbackMessage.userId.
    // Параметры идут массивом через $queryRawUnsafe, потому что список
    // topicIds динамической длины.
    const placeholders = topicIds.map((_, idx) => `$${idx + 1}`).join(', ');
    const params: unknown[] = [...topicIds];
    let sinceClause = '';
    if (since !== null) {
      params.push(since);
      sinceClause = `AND fi."createdAt" >= $${params.length}`;
    }
    const sql = `
      SELECT fi."topicId" AS topic_id,
             COUNT(DISTINCT fm."userId")::int AS users_count
      FROM "FeedbackItem" fi
      JOIN "FeedbackMessage" fm ON fm."id" = fi."messageId"
      WHERE fi."topicId" IN (${placeholders})
        AND fi."discarded" = false
        ${sinceClause}
      GROUP BY fi."topicId"
    `;
    const usersRows = await this.prisma.$queryRawUnsafe<
      Array<{ topic_id: string; users_count: number }>
    >(sql, ...params);

    for (const row of usersRows) {
      const existing = result.get(row.topic_id);
      if (existing) {
        existing.uniqueUsersCount = Number(row.users_count) || 0;
      } else {
        // На случай, если items есть, но groupBy выше не вернул — не должно
        // случаться при одинаковых WHERE, но защитимся.
        result.set(row.topic_id, {
          itemsCount: 0,
          uniqueUsersCount: Number(row.users_count) || 0,
          lastItemAt: null,
        });
      }
    }

    // Топики без items в окне — нужны для percent=0, lastItemAt=null.
    for (const topicId of topicIds) {
      if (!result.has(topicId)) {
        result.set(topicId, {
          itemsCount: 0,
          uniqueUsersCount: 0,
          lastItemAt: null,
        });
      }
    }

    return result;
  }

  /**
   * Общее число items в окне (discarded=false). Знаменатель для percent.
   */
  private async countTotalItemsInWindow(since: Date | null): Promise<number> {
    const where: Prisma.FeedbackItemWhereInput = { discarded: false };
    if (since !== null) {
      where.createdAt = { gte: since };
    }
    return this.prisma.feedbackItem.count({ where });
  }

  /**
   * Общее число уникальных пользователей в окне (по items с discarded=false).
   * Считаем через raw SQL — DISTINCT по FeedbackMessage.userId.
   */
  private async countTotalUsersInWindow(since: Date | null): Promise<number> {
    const params: unknown[] = [];
    let sinceClause = '';
    if (since !== null) {
      params.push(since);
      sinceClause = `AND fi."createdAt" >= $${params.length}`;
    }
    const sql = `
      SELECT COUNT(DISTINCT fm."userId")::int AS users_count
      FROM "FeedbackItem" fi
      JOIN "FeedbackMessage" fm ON fm."id" = fi."messageId"
      WHERE fi."discarded" = false
        ${sinceClause}
    `;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ users_count: number }>
    >(sql, ...params);
    const first = rows[0];
    return first ? Number(first.users_count) || 0 : 0;
  }
}

// ──────────────────────────── module-private helpers ────────────────────────────

/**
 * Возвращает начало окна (UTC). `null` если window=all.
 */
function windowSince(window: FeedbackTopicWindow): Date | null {
  if (window === 'all') return null;
  const days = window === '30' ? 30 : 90;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  return since;
}

/**
 * Считает процент с точностью 1 знак после запятой. 0 если total <= 0.
 */
function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Сравнение топиков по выбранной сортировке. Для percent сортируем по
 * itemsCount — он линейно связан с percent, но не зависит от знаменателя.
 */
function compareTopics(
  a: { itemsCount: number; uniqueUsersCount: number; lastItemAt: string | null; createdAt: string },
  b: { itemsCount: number; uniqueUsersCount: number; lastItemAt: string | null; createdAt: string },
  sort: TopicListFilters['sort'],
): number {
  switch (sort) {
    case 'percent':
      if (b.itemsCount !== a.itemsCount) return b.itemsCount - a.itemsCount;
      return b.createdAt.localeCompare(a.createdAt);
    case 'users':
      if (b.uniqueUsersCount !== a.uniqueUsersCount) {
        return b.uniqueUsersCount - a.uniqueUsersCount;
      }
      return b.createdAt.localeCompare(a.createdAt);
    case 'recent': {
      // NULLs last
      if (a.lastItemAt === null && b.lastItemAt === null) {
        return b.createdAt.localeCompare(a.createdAt);
      }
      if (a.lastItemAt === null) return 1;
      if (b.lastItemAt === null) return -1;
      const diff = b.lastItemAt.localeCompare(a.lastItemAt);
      if (diff !== 0) return diff;
      return b.createdAt.localeCompare(a.createdAt);
    }
  }
}
