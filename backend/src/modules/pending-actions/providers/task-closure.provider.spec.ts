import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TaskClosurePendingProvider } from './task-closure.provider';

function makeCfg(autoConfirmThreshold = 0.95): TypedConfigService {
  return {
    pendingActions: {
      reminderWindowStartHour: 9,
      reminderWindowEndHour: 21,
      reminderStepHours: 3,
      urgentAgeDays: 5,
      reminderLeadDays: 3,
    },
    getDynamic: vi.fn().mockResolvedValue(autoConfirmThreshold),
  } as unknown as TypedConfigService;
}

describe('TaskClosurePendingProvider (Ф2/TZ1-Ф4)', () => {
  let prisma: PrismaService;
  let provider: TaskClosurePendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;
  let issueFindMany: ReturnType<typeof vi.fn>;
  let assigneeFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn().mockResolvedValue(0);
    findManyMock = vi.fn().mockResolvedValue([]);
    issueFindMany = vi.fn().mockResolvedValue([]);
    assigneeFindMany = vi.fn().mockResolvedValue([]);
    prisma = {
      taskClosureCandidate: { count: countMock, findMany: findManyMock },
      issue: { findMany: issueFindMany },
      issueAssignee: { findMany: assigneeFindMany },
    } as unknown as PrismaService;
    provider = new TaskClosurePendingProvider(prisma, makeCfg());
  });

  it('owner: count без issueId-фильтра, обращается к БД (status=pending)', async () => {
    countMock.mockResolvedValue(3);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(3);
    const where = countMock.mock.calls[0]![0].where;
    expect(where.status).toBe('pending');
    expect(where.issueId).toBeUndefined();
    expect(assigneeFindMany).not.toHaveBeenCalled();
  });

  it('admin: count без issueId-фильтра', async () => {
    countMock.mockResolvedValue(2);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'admin',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(2);
    expect(countMock.mock.calls[0]![0].where.issueId).toBeUndefined();
    expect(assigneeFindMany).not.toHaveBeenCalled();
  });

  it('member-исполнитель: count ограничен issueId назначенных задач', async () => {
    assigneeFindMany.mockResolvedValue([
      { issueId: 'iss-1' },
      { issueId: 'iss-2' },
    ]);
    countMock.mockResolvedValue(1);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-9',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(1);
    expect(assigneeFindMany.mock.calls[0]![0].where.userId).toBe('u-9');
    expect(countMock.mock.calls[0]![0].where.issueId).toEqual({
      in: ['iss-1', 'iss-2'],
    });
  });

  it('member без назначенных задач: count=0, list=[] (in: [])', async () => {
    assigneeFindMany.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-9',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(0);
    expect(countMock.mock.calls[0]![0].where.issueId).toEqual({ in: [] });

    const list = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-9',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(list).toEqual([]);
    expect(findManyMock.mock.calls[0]![0].where.issueId).toEqual({ in: [] });
  });

  it('member-исполнитель: видит свой кандидат на закрытие', async () => {
    assigneeFindMany.mockResolvedValue([{ issueId: 'iss-1' }]);
    findManyMock.mockResolvedValue([
      {
        id: 'tcc-1',
        issueId: 'iss-1',
        confidence: { toString: () => '0.97' },
        rationale: 'Прямо сказано, что отправлено',
        evidenceQuote: 'КП отправил утром',
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    ]);
    issueFindMany.mockResolvedValue([
      { id: 'iss-1', title: 'Отправить КП клиенту Бета' },
    ]);

    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-9',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });

    expect(items).toHaveLength(1);
    expect(findManyMock.mock.calls[0]![0].where.issueId).toEqual({
      in: ['iss-1'],
    });
    const a = items[0]!;
    expect(a.resourceType).toBe('task_closure_candidate');
    expect(a.title).toContain('Отправить КП клиенту Бета');
    expect(a.severity).toBe('urgent');
    expect(a.canQuickConfirm).toBe(true);
  });

  it('snooze-фильтр сохраняется (id notIn)', async () => {
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      snoozedResourceIds: new Set(['tcc-snoozed']),
    });
    expect(countMock.mock.calls[0]![0].where.id).toEqual({
      notIn: ['tcc-snoozed'],
    });
  });

  it('list: резолвит заголовок задачи, canQuickConfirm по confidence (owner)', async () => {
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([
      {
        id: 'tcc-1',
        issueId: 'iss-1',
        confidence: { toString: () => '0.97' },
        rationale: 'Прямо сказано, что отправлено',
        evidenceQuote: 'КП отправил утром',
        createdAt: old,
      },
      {
        id: 'tcc-2',
        issueId: 'iss-2',
        confidence: { toString: () => '0.80' },
        rationale: null,
        evidenceQuote: null,
        createdAt: new Date(),
      },
    ]);
    issueFindMany.mockResolvedValue([
      { id: 'iss-1', title: 'Отправить КП клиенту Бета' },
      { id: 'iss-2', title: 'Согласовать макет' },
    ]);

    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      limit: 50,
      snoozedResourceIds: new Set(),
    });

    expect(items).toHaveLength(2);
    const a = items[0]!;
    expect(a.resourceType).toBe('task_closure_candidate');
    expect(a.title).toContain('Отправить КП клиенту Бета');
    expect(a.severity).toBe('urgent');
    expect(a.canQuickConfirm).toBe(true);
    const b = items[1]!;
    expect(b.severity).toBe('normal');
    expect(b.canQuickConfirm).toBe(false);
  });
});
