import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FeedbackTopicStatus, type Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  FeedbackItemMessageResponse,
  FeedbackItemsListResponse,
} from '../dto/feedback-item.dto';
import type {
  FeedbackTopicDetail,
  FeedbackTopicSummary,
  FeedbackTopicsListResponse,
} from '../dto/feedback-topic.dto';
import type { MergeTopicsBody } from '../dto/merge-topics.dto';
import type { RenameTopicBody } from '../dto/rename-topic.dto';
import type { FeedbackTopicWindow, TopicListFilters } from '../dto/topic-list-filters.dto';

@Injectable()
export class FeedbackTopicManagerService {
  private readonly logger = new Logger(FeedbackTopicManagerService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listTopics(filters: TopicListFilters): Promise<FeedbackTopicsListResponse> {
    const since = windowSince(filters.window);

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

    const itemsAggregates = await this.aggregateItemsByTopic(topicIds, since);

    const totalItemsInWindow = await this.countTotalItemsInWindow(since);

    const totalUsersInWindow = await this.countTotalUsersInWindow(since);

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

    summaries.sort((a, b) => compareTopics(a, b, filters.sort));

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

  async getTopic(id: string, window: FeedbackTopicWindow): Promise<FeedbackTopicDetail> {
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

  async listItems(
    topicId: string,
    page: number,
    pageSize: number,
  ): Promise<FeedbackItemsListResponse> {
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
        org: r.message.org ? { id: r.message.org.id, name: r.message.org.name } : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getItemMessage(topicId: string, itemId: string): Promise<FeedbackItemMessageResponse> {
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
    if (item.topicId !== topicId) {
      throw new NotFoundException(`FeedbackItem ${itemId} не принадлежит блоку ${topicId}`);
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

  async rename(id: string, body: RenameTopicBody): Promise<FeedbackTopicDetail> {
    const existing = await this.prisma.feedbackTopic.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      throw new NotFoundException(`FeedbackTopic ${id} не найден`);
    }
    if (existing.status === FeedbackTopicStatus.MERGED) {
      throw new BadRequestException('Нельзя переименовать блок в статусе MERGED');
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

  async merge(
    sourceId: string,
    body: MergeTopicsBody,
  ): Promise<{ movedItems: number; mergedIntoId: string }> {
    const { targetId } = body;
    if (sourceId === targetId) {
      throw new BadRequestException('Нельзя объединить блок с самим собой');
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
      throw new BadRequestException('Target-блок в статусе MERGED — выберите активный target');
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

    this.logger.log({ topicId: id }, 'feedback-admin.unarchive: блок восстановлен из архива');
    return this.getTopic(id, '30');
  }

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
        uniqueUsersCount: 0,
        lastItemAt: row._max.createdAt,
      });
    }

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
        result.set(row.topic_id, {
          itemsCount: 0,
          uniqueUsersCount: Number(row.users_count) || 0,
          lastItemAt: null,
        });
      }
    }

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

  private async countTotalItemsInWindow(since: Date | null): Promise<number> {
    const where: Prisma.FeedbackItemWhereInput = { discarded: false };
    if (since !== null) {
      where.createdAt = { gte: since };
    }
    return this.prisma.feedbackItem.count({ where });
  }

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
    const rows = await this.prisma.$queryRawUnsafe<Array<{ users_count: number }>>(sql, ...params);
    const first = rows[0];
    return first ? Number(first.users_count) || 0 : 0;
  }
}

function windowSince(window: FeedbackTopicWindow): Date | null {
  if (window === 'all') return null;
  const days = window === '30' ? 30 : 90;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  return since;
}

function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

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
