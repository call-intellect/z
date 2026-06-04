import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { MeetingActionItemsService } from './meeting-action-items.service';

/**
 * ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 5.2 — unit на
 * `MeetingActionItemsService`. Проверяем gate-парность:
 *   - флаг OFF (дефолт) → читаем Task, нормализуем форму;
 *   - флаг ON → читаем Issue по linkedMeetingIds, маппим в MeetingActionItem.
 */

function makeCfg(trackerOnly: boolean): TypedConfigService {
  return {
    getDynamic: vi.fn(async () => trackerOnly),
  } as unknown as TypedConfigService;
}

/** Достаёт первый аргумент первого вызова мок-функции (where-объект запроса). */
function firstCallArg(fn: ReturnType<typeof vi.fn>): {
  where: Record<string, unknown>;
} {
  const calls = fn.mock.calls as unknown as unknown[][];
  return calls[0]![0] as { where: Record<string, unknown> };
}

describe('MeetingActionItemsService.listForMeeting', () => {
  it('флаг OFF → читает Task с фильтром по meetingId/tenantId и нормализует', async () => {
    const findMany = vi.fn(async () => [
      {
        id: 't1',
        meetingId: 'm1',
        title: 'Подготовить отчёт',
        description: 'desc',
        status: 'open',
        assigneeRaw: 'Настя',
        assigneeUserId: 'u-nastya',
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        sourceQuote: 'цитата',
        confidence: 0.9,
        extractorVersion: 'fast',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-02T00:00:00.000Z'),
      },
    ]);
    const prisma = {
      task: { findMany },
      issue: { findMany: vi.fn() },
    } as unknown as PrismaService;

    const svc = new MeetingActionItemsService(prisma, makeCfg(false));
    const out = await svc.listForMeeting({ meetingId: 'm1', tenantId: 't1' });

    // Запрос к Task (не к Issue).
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = firstCallArg(findMany);
    expect(arg.where.meetingId).toBe('m1');
    expect(arg.where.tenantId).toBe('t1');

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 't1',
      meetingId: 'm1',
      title: 'Подготовить отчёт',
      status: 'open',
      assigneeUserId: 'u-nastya',
      assigneeRaw: 'Настя',
      sourceQuote: 'цитата',
      confidence: 0.9,
      extractorVersion: 'fast',
    });
    expect(out[0]?.dueDate).toBeInstanceOf(Date);
  });

  it('флаг OFF без tenantId → не добавляет tenant-фильтр (legacy null-tenant встречи)', async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      task: { findMany },
      issue: { findMany: vi.fn() },
    } as unknown as PrismaService;

    const svc = new MeetingActionItemsService(prisma, makeCfg(false));
    await svc.listForMeeting({ meetingId: 'm1', tenantId: '' });

    const arg = firstCallArg(findMany);
    expect(arg.where.meetingId).toBe('m1');
    expect('tenantId' in arg.where).toBe(false);
  });

  it('флаг ON → читает Issue по linkedMeetingIds и маппит Issue→MeetingActionItem', async () => {
    const issueFindMany = vi.fn(async () => [
      {
        id: 'i1',
        title: 'Issue из встречи',
        descriptionStripped: 'тело задачи',
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        confidence: { toString: () => '0.880', valueOf: () => 0.88 } as unknown,
        externalSource: 'meeting',
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        updatedAt: new Date('2026-06-04T00:00:00.000Z'),
        state: { category: 'started' },
        assignees: [{ userId: 'u-issue' }],
      },
    ]);
    const prisma = {
      task: { findMany: vi.fn() },
      issue: { findMany: issueFindMany },
    } as unknown as PrismaService;

    const svc = new MeetingActionItemsService(prisma, makeCfg(true));
    const out = await svc.listForMeeting({
      meetingId: 'm1',
      tenantId: 't1',
      userId: 'u-issue',
    });

    // Запрос к Issue по has(meetingId) + tenant.
    expect(issueFindMany).toHaveBeenCalledTimes(1);
    const arg = firstCallArg(issueFindMany);
    expect(arg.where.tenantId).toBe('t1');
    expect(arg.where.linkedMeetingIds).toEqual({ has: 'm1' });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'i1',
      meetingId: 'm1',
      title: 'Issue из встречи',
      // state.category 'started' → 'in_progress'
      status: 'in_progress',
      assigneeUserId: 'u-issue',
      // Issue не хранит сырую строку-имя
      assigneeRaw: null,
      description: 'тело задачи',
    });
    expect(out[0]?.confidence).toBeCloseTo(0.88, 3);
    expect(out[0]?.dueDate).toBeInstanceOf(Date);
  });

  it('маппинг статусов Issue.category → TaskStatus-строка', async () => {
    const cases: Array<[string, string]> = [
      ['backlog', 'open'],
      ['unstarted', 'open'],
      ['started', 'in_progress'],
      ['completed', 'done'],
      ['cancelled', 'cancelled'],
    ];
    for (const [category, expected] of cases) {
      const issueFindMany = vi.fn(async () => [
        {
          id: 'i',
          title: 't',
          descriptionStripped: null,
          dueDate: null,
          confidence: null,
          externalSource: 'meeting',
          createdAt: new Date(),
          updatedAt: new Date(),
          state: { category },
          assignees: [],
        },
      ]);
      const prisma = {
        task: { findMany: vi.fn() },
        issue: { findMany: issueFindMany },
      } as unknown as PrismaService;
      const svc = new MeetingActionItemsService(prisma, makeCfg(true));
      const out = await svc.listForMeeting({ meetingId: 'm1', tenantId: 't1' });
      expect(out[0]?.status).toBe(expected);
      expect(out[0]?.assigneeUserId).toBeNull();
    }
  });
});

describe('MeetingActionItemsService.searchTitlesForUser', () => {
  it('флаг OFF → ищет по Task пользователя, форма {id,title,status,meetingId}', async () => {
    const findMany = vi.fn(async () => [
      { id: 't1', title: 'Найти', status: 'open', meetingId: 'm1' },
    ]);
    const prisma = {
      task: { findMany },
      issue: { findMany: vi.fn() },
    } as unknown as PrismaService;
    const svc = new MeetingActionItemsService(prisma, makeCfg(false));
    const out = await svc.searchTitlesForUser({
      tenantId: 't1',
      userId: 'u1',
      query: 'Най',
      limit: 10,
    });
    const arg = firstCallArg(findMany);
    expect(arg.where.userId).toBe('u1');
    expect(out).toEqual([
      { id: 't1', title: 'Найти', status: 'open', meetingId: 'm1' },
    ]);
  });

  it('флаг ON → ищет по Issue (externalSource=meeting), meetingId из linkedMeetingIds[0]', async () => {
    const issueFindMany = vi.fn(async () => [
      {
        id: 'i1',
        title: 'Issue найти',
        linkedMeetingIds: ['m1', 'm2'],
        state: { category: 'completed' },
      },
    ]);
    const prisma = {
      task: { findMany: vi.fn() },
      issue: { findMany: issueFindMany },
    } as unknown as PrismaService;
    const svc = new MeetingActionItemsService(prisma, makeCfg(true));
    const out = await svc.searchTitlesForUser({
      tenantId: 't1',
      userId: 'u1',
      query: 'най',
      limit: 10,
    });
    const arg = firstCallArg(issueFindMany);
    expect(arg.where.externalSource).toBe('meeting');
    expect(out).toEqual([
      { id: 'i1', title: 'Issue найти', status: 'done', meetingId: 'm1' },
    ]);
  });
});
