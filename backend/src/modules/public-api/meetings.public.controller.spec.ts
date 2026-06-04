import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MeetingActionItemsService } from '../meetings/meeting-action-items.service';

import { MeetingsPublicController } from './meetings.public.controller';

/**
 * ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 5.2 —
 * контракт-тест публичного API `GET /api/public/v1/meetings/:id/tasks`.
 *
 * Гарантия безопасности: при флаге OFF (дефолт) форма ответа байт-в-байт
 * совпадает с прежней (полный объект Task). При флаге ON задача берётся из
 * Issue, но отдаётся в ТОМ ЖЕ наборе полей (внешний контракт не ломается).
 */

// Полный набор полей, который внешний API отдавал из `prisma.task.findMany`.
const TASK_CONTRACT_FIELDS = [
  'id',
  'tenantId',
  'meetingId',
  'userId',
  'title',
  'description',
  'status',
  'assigneeRaw',
  'assigneeUserId',
  'dueDate',
  'sourceStartMs',
  'sourceEndMs',
  'sourceQuote',
  'confidence',
  'createdManually',
  'evidenceBlockIds',
  'extractorVersion',
  'createdAt',
  'updatedAt',
] as const;

function makeFullTask() {
  return {
    id: 't1',
    tenantId: 'tenant-1',
    meetingId: 'm1',
    userId: 'u1',
    title: 'Задача',
    description: null,
    status: 'open',
    assigneeRaw: 'Настя',
    assigneeUserId: 'u-nastya',
    dueDate: new Date('2026-07-01T00:00:00.000Z'),
    sourceStartMs: 1000,
    sourceEndMs: 2000,
    sourceQuote: 'цитата',
    confidence: 0.9,
    createdManually: false,
    evidenceBlockIds: [] as string[],
    extractorVersion: 'fast',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
  };
}

describe('MeetingsPublicController GET /meetings/:id/tasks — контракт Ф5.2', () => {
  it('флаг OFF → отдаёт полный Task; форма ответа прежняя', async () => {
    const taskFindMany = vi.fn(async () => [makeFullTask()]);
    const prisma = {
      meeting: {
        findFirst: vi.fn(async () => ({ id: 'm1', tenantId: 'tenant-1' })),
      },
      task: { findMany: taskFindMany },
    } as unknown as PrismaService;
    const actionItems = {
      isTrackerOnly: vi.fn(async () => false),
      listForMeeting: vi.fn(),
    } as unknown as MeetingActionItemsService;

    const ctrl = new MeetingsPublicController(prisma, actionItems);
    const res = await ctrl.tasks('u1', 'm1');

    expect(taskFindMany).toHaveBeenCalledTimes(1);
    expect(res.items).toHaveLength(1);
    for (const f of TASK_CONTRACT_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(res.items[0], f)).toBe(true);
    }
    expect(res.items[0]).toMatchObject({ id: 't1', meetingId: 'm1', userId: 'u1' });
  });

  it('флаг ON → отдаёт Issue, но в ТОМ ЖЕ наборе полей контракта', async () => {
    const prisma = {
      meeting: {
        findFirst: vi.fn(async () => ({ id: 'm1', tenantId: 'tenant-1' })),
      },
      task: { findMany: vi.fn() },
    } as unknown as PrismaService;
    const listForMeeting = vi.fn(async () => [
      {
        id: 'i1',
        meetingId: 'm1',
        title: 'Issue из встречи',
        description: 'тело',
        status: 'in_progress',
        assigneeRaw: null,
        assigneeUserId: 'u-issue',
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        sourceQuote: null,
        confidence: 0.88,
        extractorVersion: 'meeting',
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        updatedAt: new Date('2026-06-04T00:00:00.000Z'),
      },
    ]);
    const actionItems = {
      isTrackerOnly: vi.fn(async () => true),
      listForMeeting,
    } as unknown as MeetingActionItemsService;

    const ctrl = new MeetingsPublicController(prisma, actionItems);
    const res = await ctrl.tasks('u1', 'm1');

    expect(listForMeeting).toHaveBeenCalledTimes(1);
    expect(res.items).toHaveLength(1);
    // Контракт: тот же набор полей, что и при OFF.
    for (const f of TASK_CONTRACT_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(res.items[0], f)).toBe(true);
    }
    expect(res.items[0]).toMatchObject({
      id: 'i1',
      meetingId: 'm1',
      userId: 'u1',
      tenantId: 'tenant-1',
      title: 'Issue из встречи',
      assigneeUserId: 'u-issue',
      // Поля, которых нет у Issue — нейтральные дефолты (контракт сохранён).
      sourceStartMs: null,
      sourceEndMs: null,
      createdManually: false,
      evidenceBlockIds: [],
    });
  });
});
