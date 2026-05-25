/**
 * Unit-тесты для FeedbackTopicManagerService (admin часть feedback).
 *
 * Покрытие:
 *   - rename: успех, 404, MERGED → 400, ACTIVE/ARCHIVED → OK
 *   - merge: транзакция, source→MERGED, mergedIntoId выставляется,
 *            source==target → 400, MERGED target → 400, MERGED source → 400
 *   - archive: ACTIVE → ARCHIVED + archivedAt; не из ACTIVE → 400
 *   - unarchive: ARCHIVED → ACTIVE + archivedAt=null; не из ARCHIVED → 400
 *   - listTopics: процент, сортировки, фильтр includeArchived, q
 *   - getItemMessage: 404, mismatch topicId, success
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FeedbackTopicStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { FeedbackTopicManagerService } from './feedback-topic-manager.service';

// ──────────────────────────── prisma stub ────────────────────────────

interface PrismaCalls {
  topicFindUnique: ReturnType<typeof vi.fn>;
  topicFindMany: ReturnType<typeof vi.fn>;
  topicUpdate: ReturnType<typeof vi.fn>;
  itemGroupBy: ReturnType<typeof vi.fn>;
  itemCount: ReturnType<typeof vi.fn>;
  itemFindMany: ReturnType<typeof vi.fn>;
  itemFindUnique: ReturnType<typeof vi.fn>;
  itemUpdateMany: ReturnType<typeof vi.fn>;
  queryRawUnsafe: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

interface PrismaStub {
  prisma: PrismaService;
  calls: PrismaCalls;
}

function makePrisma(options: {
  topicFindUnique?: (args: unknown) => unknown;
  topicFindMany?: (args: unknown) => unknown[];
  topicUpdate?: (args: unknown) => unknown;
  itemGroupBy?: (args: unknown) => unknown[];
  itemCount?: (args: unknown) => number;
  itemFindMany?: (args: unknown) => unknown[];
  itemFindUnique?: (args: unknown) => unknown;
  itemUpdateMany?: (args: unknown) => { count: number };
  queryRawUnsafe?: (sql: string, ...params: unknown[]) => unknown[];
} = {}): PrismaStub {
  const topicFindUnique = vi.fn(async (args: unknown) =>
    options.topicFindUnique ? options.topicFindUnique(args) : null,
  );
  const topicFindMany = vi.fn(async (args: unknown) =>
    options.topicFindMany ? options.topicFindMany(args) : [],
  );
  const topicUpdate = vi.fn(async (args: unknown) =>
    options.topicUpdate ? options.topicUpdate(args) : { id: 'x' },
  );
  const itemGroupBy = vi.fn(async (args: unknown) =>
    options.itemGroupBy ? options.itemGroupBy(args) : [],
  );
  const itemCount = vi.fn(async (args: unknown) =>
    options.itemCount ? options.itemCount(args) : 0,
  );
  const itemFindMany = vi.fn(async (args: unknown) =>
    options.itemFindMany ? options.itemFindMany(args) : [],
  );
  const itemFindUnique = vi.fn(async (args: unknown) =>
    options.itemFindUnique ? options.itemFindUnique(args) : null,
  );
  const itemUpdateMany = vi.fn(async (args: unknown) =>
    options.itemUpdateMany ? options.itemUpdateMany(args) : { count: 0 },
  );
  const queryRawUnsafe = vi.fn(async (sql: string, ...params: unknown[]) =>
    options.queryRawUnsafe ? options.queryRawUnsafe(sql, ...params) : [],
  );

  const txClient = {
    feedbackTopic: { update: topicUpdate, findUnique: topicFindUnique },
    feedbackItem: {
      updateMany: itemUpdateMany,
      findMany: itemFindMany,
      count: itemCount,
    },
  };

  const transaction = vi.fn(
    async (
      arg:
        | Promise<unknown>[]
        | ((tx: typeof txClient) => Promise<unknown>),
    ) => {
      if (typeof arg === 'function') {
        return arg(txClient);
      }
      return Promise.all(arg);
    },
  );

  const prisma = {
    feedbackTopic: {
      findUnique: topicFindUnique,
      findMany: topicFindMany,
      update: topicUpdate,
    },
    feedbackItem: {
      groupBy: itemGroupBy,
      count: itemCount,
      findMany: itemFindMany,
      findUnique: itemFindUnique,
      updateMany: itemUpdateMany,
    },
    $queryRawUnsafe: queryRawUnsafe,
    $transaction: transaction,
  } as unknown as PrismaService;

  return {
    prisma,
    calls: {
      topicFindUnique,
      topicFindMany,
      topicUpdate,
      itemGroupBy,
      itemCount,
      itemFindMany,
      itemFindUnique,
      itemUpdateMany,
      queryRawUnsafe,
      transaction,
    },
  };
}

describe('FeedbackTopicManagerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 25, 12, 0, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ──────────────────────────── rename ────────────────────────────

  describe('rename', () => {
    it('обновляет title+description и возвращает обновлённую запись', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          // первый вызов — status check, второй вызов из getTopic
          const a = args as { select?: Record<string, unknown> };
          if (a.select && 'status' in a.select && Object.keys(a.select).length === 1) {
            return { status: FeedbackTopicStatus.ACTIVE };
          }
          return {
            id: 't-1',
            title: 'Новый заголовок',
            description: 'Новое описание',
            status: FeedbackTopicStatus.ACTIVE,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
            mergedIntoId: null,
          };
        },
        itemGroupBy: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.rename('t-1', {
        title: 'Новый заголовок',
        description: 'Новое описание',
      });
      expect(stub.calls.topicUpdate).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: {
          title: 'Новый заголовок',
          description: 'Новое описание',
        },
      });
      expect(result.title).toBe('Новый заголовок');
      expect(result.status).toBe(FeedbackTopicStatus.ACTIVE);
    });

    it('404 если блока нет', async () => {
      const stub = makePrisma({ topicFindUnique: () => null });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.rename('missing', { title: 'a', description: 'b' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400 если блок в MERGED', async () => {
      const stub = makePrisma({
        topicFindUnique: () => ({ status: FeedbackTopicStatus.MERGED }),
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.rename('t-1', { title: 'x', description: 'y' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stub.calls.topicUpdate).not.toHaveBeenCalled();
    });

    it('разрешает rename для ARCHIVED', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { select?: Record<string, unknown> };
          if (a.select && 'status' in a.select && Object.keys(a.select).length === 1) {
            return { status: FeedbackTopicStatus.ARCHIVED };
          }
          return {
            id: 't-1',
            title: 'x',
            description: 'y',
            status: FeedbackTopicStatus.ARCHIVED,
            archivedAt: now,
            createdAt: now,
            updatedAt: now,
            mergedIntoId: null,
          };
        },
        itemGroupBy: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await svc.rename('t-1', { title: 'x', description: 'y' });
      expect(stub.calls.topicUpdate).toHaveBeenCalled();
    });
  });

  // ──────────────────────────── merge ────────────────────────────

  describe('merge', () => {
    it('переносит items + помечает source MERGED + возвращает счётчик', async () => {
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { where: { id: string } };
          if (a.where.id === 's-1') return { id: 's-1', status: FeedbackTopicStatus.ACTIVE };
          if (a.where.id === 't-2') return { id: 't-2', status: FeedbackTopicStatus.ACTIVE };
          return null;
        },
        itemUpdateMany: () => ({ count: 7 }),
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);

      const result = await svc.merge('s-1', { targetId: 't-2' });

      expect(result).toEqual({ movedItems: 7, mergedIntoId: 't-2' });
      expect(stub.calls.transaction).toHaveBeenCalledTimes(1);
      expect(stub.calls.itemUpdateMany).toHaveBeenCalledWith({
        where: { topicId: 's-1' },
        data: { topicId: 't-2' },
      });
      expect(stub.calls.topicUpdate).toHaveBeenCalledWith({
        where: { id: 's-1' },
        data: {
          status: FeedbackTopicStatus.MERGED,
          mergedIntoId: 't-2',
        },
      });
    });

    it('400 если source==target', async () => {
      const stub = makePrisma();
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.merge('same', { targetId: 'same' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stub.calls.transaction).not.toHaveBeenCalled();
    });

    it('404 если source не найден', async () => {
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { where: { id: string } };
          if (a.where.id === 't-2') return { id: 't-2', status: FeedbackTopicStatus.ACTIVE };
          return null;
        },
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.merge('missing', { targetId: 't-2' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 если target не найден', async () => {
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { where: { id: string } };
          if (a.where.id === 's-1') return { id: 's-1', status: FeedbackTopicStatus.ACTIVE };
          return null;
        },
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.merge('s-1', { targetId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400 если source уже MERGED', async () => {
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { where: { id: string } };
          if (a.where.id === 's-1') return { id: 's-1', status: FeedbackTopicStatus.MERGED };
          if (a.where.id === 't-2') return { id: 't-2', status: FeedbackTopicStatus.ACTIVE };
          return null;
        },
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.merge('s-1', { targetId: 't-2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 если target в MERGED', async () => {
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { where: { id: string } };
          if (a.where.id === 's-1') return { id: 's-1', status: FeedbackTopicStatus.ACTIVE };
          if (a.where.id === 't-2') return { id: 't-2', status: FeedbackTopicStatus.MERGED };
          return null;
        },
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.merge('s-1', { targetId: 't-2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ──────────────────────────── archive/unarchive ────────────────────────────

  describe('archive', () => {
    it('из ACTIVE → ARCHIVED + archivedAt', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { select?: Record<string, unknown> };
          if (a.select && 'status' in a.select && Object.keys(a.select).length === 1) {
            return { status: FeedbackTopicStatus.ACTIVE };
          }
          return {
            id: 't-1',
            title: 'a',
            description: 'b',
            status: FeedbackTopicStatus.ARCHIVED,
            archivedAt: now,
            createdAt: now,
            updatedAt: now,
            mergedIntoId: null,
          };
        },
        itemGroupBy: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.archive('t-1');
      expect(stub.calls.topicUpdate).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: {
          status: FeedbackTopicStatus.ARCHIVED,
          archivedAt: expect.any(Date),
        },
      });
      expect(result.status).toBe(FeedbackTopicStatus.ARCHIVED);
    });

    it('400 если уже ARCHIVED', async () => {
      const stub = makePrisma({
        topicFindUnique: () => ({ status: FeedbackTopicStatus.ARCHIVED }),
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(svc.archive('t-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('400 если MERGED', async () => {
      const stub = makePrisma({
        topicFindUnique: () => ({ status: FeedbackTopicStatus.MERGED }),
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(svc.archive('t-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404 если блока нет', async () => {
      const stub = makePrisma({ topicFindUnique: () => null });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(svc.archive('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('unarchive', () => {
    it('из ARCHIVED → ACTIVE + archivedAt=null', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindUnique: (args: unknown) => {
          const a = args as { select?: Record<string, unknown> };
          if (a.select && 'status' in a.select && Object.keys(a.select).length === 1) {
            return { status: FeedbackTopicStatus.ARCHIVED };
          }
          return {
            id: 't-1',
            title: 'a',
            description: 'b',
            status: FeedbackTopicStatus.ACTIVE,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
            mergedIntoId: null,
          };
        },
        itemGroupBy: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.unarchive('t-1');
      expect(stub.calls.topicUpdate).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: {
          status: FeedbackTopicStatus.ACTIVE,
          archivedAt: null,
        },
      });
      expect(result.status).toBe(FeedbackTopicStatus.ACTIVE);
    });

    it('400 если ACTIVE', async () => {
      const stub = makePrisma({
        topicFindUnique: () => ({ status: FeedbackTopicStatus.ACTIVE }),
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(svc.unarchive('t-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ──────────────────────────── listTopics ────────────────────────────

  describe('listTopics', () => {
    it('считает percent правильно: 25% от total=4', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindMany: () => [
          {
            id: 't-1',
            title: 'A',
            description: 'desc-a',
            status: FeedbackTopicStatus.ACTIVE,
            createdAt: now,
          },
        ],
        // groupBy возвращает itemsCount=1, lastItemAt=now
        itemGroupBy: () => [
          { topicId: 't-1', _count: { _all: 1 }, _max: { createdAt: now } },
        ],
        // count items в окне = 4 — знаменатель
        itemCount: () => 4,
        // unique users по topicId t-1 = 1
        queryRawUnsafe: (sql: string) => {
          if (sql.includes('GROUP BY')) {
            return [{ topic_id: 't-1', users_count: 1 }];
          }
          // total users в окне
          return [{ users_count: 2 }];
        },
      });

      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.listTopics({
        window: '30',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });

      expect(result.totalItemsInWindow).toBe(4);
      expect(result.totalUsersInWindow).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.itemsCount).toBe(1);
      expect(result.items[0]!.uniqueUsersCount).toBe(1);
      expect(result.items[0]!.percentOfWindow).toBe(25.0);
    });

    it('percent=0 если totalItemsInWindow=0', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindMany: () => [
          {
            id: 't-1',
            title: 'A',
            description: 'd',
            status: FeedbackTopicStatus.ACTIVE,
            createdAt: now,
          },
        ],
        itemGroupBy: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [{ users_count: 0 }],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.listTopics({
        window: '30',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });
      expect(result.items[0]!.itemsCount).toBe(0);
      expect(result.items[0]!.percentOfWindow).toBe(0);
      expect(result.items[0]!.lastItemAt).toBeNull();
    });

    it('фильтрует MERGED — только ACTIVE или ARCHIVED', async () => {
      const stub = makePrisma({
        topicFindMany: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [{ users_count: 0 }],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await svc.listTopics({
        window: '30',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });
      const call = (stub.calls.topicFindMany.mock.calls[0]![0]) as {
        where: { status: { in: FeedbackTopicStatus[] } };
      };
      expect(call.where.status.in).toEqual([FeedbackTopicStatus.ACTIVE]);
    });

    it('includeArchived=true добавляет ARCHIVED', async () => {
      const stub = makePrisma({
        topicFindMany: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [{ users_count: 0 }],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await svc.listTopics({
        window: '30',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: true,
      });
      const call = (stub.calls.topicFindMany.mock.calls[0]![0]) as {
        where: { status: { in: FeedbackTopicStatus[] } };
      };
      expect(call.where.status.in).toEqual([
        FeedbackTopicStatus.ACTIVE,
        FeedbackTopicStatus.ARCHIVED,
      ]);
    });

    it('фильтр q добавляет OR по title/description с insensitive', async () => {
      const stub = makePrisma({
        topicFindMany: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [{ users_count: 0 }],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await svc.listTopics({
        window: '30',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: false,
        q: 'отчёт',
      });
      const call = (stub.calls.topicFindMany.mock.calls[0]![0]) as {
        where: { OR: Array<{ title?: unknown; description?: unknown }> };
      };
      expect(call.where.OR).toBeDefined();
      expect(call.where.OR).toHaveLength(2);
      expect(call.where.OR[0]!).toEqual({
        title: { contains: 'отчёт', mode: 'insensitive' },
      });
      expect(call.where.OR[1]!).toEqual({
        description: { contains: 'отчёт', mode: 'insensitive' },
      });
    });

    it('window=all → without createdAt filter', async () => {
      const stub = makePrisma({
        topicFindMany: () => [],
        itemCount: () => 0,
        queryRawUnsafe: () => [{ users_count: 0 }],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await svc.listTopics({
        window: 'all',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });
      // itemCount вызывался с where БЕЗ createdAt
      const call = (stub.calls.itemCount.mock.calls[0]![0]) as {
        where: Record<string, unknown>;
      };
      expect(call.where.createdAt).toBeUndefined();
    });

    it('сортирует по users: блок с большим uniqueUsersCount выше', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindMany: () => [
          {
            id: 't-1',
            title: 'A',
            description: 'a',
            status: FeedbackTopicStatus.ACTIVE,
            createdAt: now,
          },
          {
            id: 't-2',
            title: 'B',
            description: 'b',
            status: FeedbackTopicStatus.ACTIVE,
            createdAt: now,
          },
        ],
        itemGroupBy: () => [
          { topicId: 't-1', _count: { _all: 10 }, _max: { createdAt: now } },
          { topicId: 't-2', _count: { _all: 5 }, _max: { createdAt: now } },
        ],
        itemCount: () => 15,
        queryRawUnsafe: (sql: string) => {
          if (sql.includes('GROUP BY')) {
            return [
              { topic_id: 't-1', users_count: 1 },
              { topic_id: 't-2', users_count: 9 },
            ];
          }
          return [{ users_count: 10 }];
        },
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.listTopics({
        window: '30',
        sort: 'users',
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });
      expect(result.items[0]!.id).toBe('t-2'); // больше users
      expect(result.items[1]!.id).toBe('t-1');
    });

    it('пагинация: page=2 pageSize=1 → второй элемент', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindMany: () => [
          {
            id: 't-1',
            title: 'A',
            description: 'a',
            status: FeedbackTopicStatus.ACTIVE,
            createdAt: now,
          },
          {
            id: 't-2',
            title: 'B',
            description: 'b',
            status: FeedbackTopicStatus.ACTIVE,
            createdAt: now,
          },
        ],
        itemGroupBy: () => [
          { topicId: 't-1', _count: { _all: 3 }, _max: { createdAt: now } },
          { topicId: 't-2', _count: { _all: 1 }, _max: { createdAt: now } },
        ],
        itemCount: () => 4,
        queryRawUnsafe: () => [{ users_count: 0 }],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.listTopics({
        window: '30',
        sort: 'percent',
        page: 2,
        pageSize: 1,
        includeArchived: false,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('t-2');
      expect(result.totalTopicsInWindow).toBe(2);
    });
  });

  // ──────────────────────────── getItemMessage ────────────────────────────

  describe('getItemMessage', () => {
    it('404 если item не найден', async () => {
      const stub = makePrisma({ itemFindUnique: () => null });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.getItemMessage('t-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 если item принадлежит другому topic', async () => {
      const stub = makePrisma({
        itemFindUnique: () => ({
          topicId: 'OTHER',
          message: {
            id: 'm-1',
            text: 'x',
            createdAt: new Date(),
            userId: 'u',
            orgId: null,
            user: { id: 'u', email: 'a@b.c', name: null },
            org: null,
          },
        }),
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(
        svc.getItemMessage('t-1', 'i-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('возвращает поля message + user + org', async () => {
      const createdAt = new Date(Date.UTC(2026, 4, 25, 11, 0, 0));
      const stub = makePrisma({
        itemFindUnique: () => ({
          topicId: 't-1',
          message: {
            id: 'm-1',
            text: 'Полный текст',
            createdAt,
            userId: 'u-1',
            orgId: 'o-1',
            user: { id: 'u-1', email: 'u@z', name: 'User' },
            org: { id: 'o-1', name: 'Org' },
          },
        }),
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.getItemMessage('t-1', 'i-1');
      expect(result).toEqual({
        id: 'm-1',
        text: 'Полный текст',
        createdAt: createdAt.toISOString(),
        userId: 'u-1',
        orgId: 'o-1',
        user: { id: 'u-1', email: 'u@z', name: 'User' },
        org: { id: 'o-1', name: 'Org' },
      });
    });
  });

  // ──────────────────────────── getTopic ────────────────────────────

  describe('getTopic', () => {
    it('404 если блок не найден', async () => {
      const stub = makePrisma({ topicFindUnique: () => null });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(svc.getTopic('missing', '30')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('возвращает агрегаты по выбранному окну', async () => {
      const now = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));
      const stub = makePrisma({
        topicFindUnique: () => ({
          id: 't-1',
          title: 'A',
          description: 'd',
          status: FeedbackTopicStatus.ACTIVE,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
          mergedIntoId: null,
        }),
        itemGroupBy: () => [
          { topicId: 't-1', _count: { _all: 3 }, _max: { createdAt: now } },
        ],
        itemCount: () => 10,
        queryRawUnsafe: () => [{ topic_id: 't-1', users_count: 2 }],
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.getTopic('t-1', '30');
      expect(result.itemsCount).toBe(3);
      expect(result.uniqueUsersCount).toBe(2);
      expect(result.percentOfWindow).toBe(30.0); // 3/10 = 30%
      expect(result.lastItemAt).toBe(now.toISOString());
    });
  });

  // ──────────────────────────── listItems ────────────────────────────

  describe('listItems', () => {
    it('404 если блока нет', async () => {
      const stub = makePrisma({ topicFindUnique: () => null });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      await expect(svc.listItems('missing', 1, 50)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('возвращает items с user/org, сортировка desc, фильтр discarded=false', async () => {
      const t1 = new Date(Date.UTC(2026, 4, 25, 10, 0, 0));
      const stub = makePrisma({
        topicFindUnique: () => ({ id: 't-1' }),
        itemFindMany: () => [
          {
            id: 'i-1',
            text: 'тезис',
            createdAt: t1,
            messageId: 'm-1',
            discarded: false,
            discardReason: null,
            message: {
              user: { id: 'u-1', email: 'a@b', name: 'Alice' },
              org: { id: 'o-1', name: 'Org' },
            },
          },
        ],
        itemCount: () => 1,
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.listItems('t-1', 1, 50);
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual({
        id: 'i-1',
        text: 'тезис',
        createdAt: t1.toISOString(),
        messageId: 'm-1',
        discarded: false,
        discardReason: null,
        user: { id: 'u-1', email: 'a@b', name: 'Alice' },
        org: { id: 'o-1', name: 'Org' },
      });
      // Проверим параметры findMany
      const findManyCall = (stub.calls.itemFindMany.mock.calls[0]![0]) as {
        where: { topicId: string; discarded: boolean };
        orderBy: { createdAt: string };
        skip: number;
        take: number;
      };
      expect(findManyCall.where).toEqual({ topicId: 't-1', discarded: false });
      expect(findManyCall.orderBy).toEqual({ createdAt: 'desc' });
      expect(findManyCall.skip).toBe(0);
      expect(findManyCall.take).toBe(50);
    });

    it('org=null если у сообщения нет org', async () => {
      const t1 = new Date(Date.UTC(2026, 4, 25, 10, 0, 0));
      const stub = makePrisma({
        topicFindUnique: () => ({ id: 't-1' }),
        itemFindMany: () => [
          {
            id: 'i-1',
            text: 'x',
            createdAt: t1,
            messageId: 'm-1',
            discarded: false,
            discardReason: null,
            message: {
              user: { id: 'u-1', email: 'a@b', name: null },
              org: null,
            },
          },
        ],
        itemCount: () => 1,
      });
      const svc = new FeedbackTopicManagerService(stub.prisma);
      const result = await svc.listItems('t-1', 1, 50);
      expect(result.items[0]!.org).toBeNull();
    });
  });
});
