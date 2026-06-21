import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ProgressDraftPendingProvider } from './progress-draft.provider';

function makeCfg(urgentAgeDays = 5): TypedConfigService {
  return {
    pendingActions: {
      reminderWindowStartHour: 9,
      reminderWindowEndHour: 21,
      reminderStepHours: 3,
      urgentAgeDays,
      reminderLeadDays: 3,
    },
    getDynamic: vi.fn(),
  } as unknown as TypedConfigService;
}

describe('ProgressDraftPendingProvider (Ф8/R17a)', () => {
  let prisma: PrismaService;
  let provider: ProgressDraftPendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;
  let issueFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn().mockResolvedValue(0);
    findManyMock = vi.fn().mockResolvedValue([]);
    issueFindMany = vi.fn().mockResolvedValue([]);
    prisma = {
      issueProgressUpdate: { count: countMock, findMany: findManyMock },
      issue: { findMany: issueFindMany },
    } as unknown as PrismaService;
    provider = new ProgressDraftPendingProvider(prisma, makeCfg());
  });

  it('исполнитель (member): where фильтрует по assignees.some.userId', async () => {
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-exec',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    const where = countMock.mock.calls[0]![0].where;
    expect(where.draftState).toBe('pending');
    expect(where.authorType).toBe('ai_agent');
    expect(where.deletedAt).toBeNull();
    expect(where.issue).toEqual({ assignees: { some: { userId: 'u-exec' } } });
  });

  it('owner: where БЕЗ фильтра по assignee (видит все черновики Org)', async () => {
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      snoozedResourceIds: new Set(),
    });
    const where = countMock.mock.calls[0]![0].where;
    expect(where.issue).toBeUndefined();
  });

  it('list: резолвит заголовок задачи, title человеческий, canQuickConfirm=true', async () => {
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([
      {
        id: 'pu-1',
        issueId: 'iss-1',
        health: 'on_track',
        body: 'Подготовлен черновик договора, осталось согласовать сумму.',
        evidenceQuote: 'Договор почти готов',
        confidence: { toString: () => '0.91' },
        createdAt: old,
      },
    ]);
    issueFindMany.mockResolvedValue([
      { id: 'iss-1', title: 'Подготовить договор с клиентом Гамма' },
    ]);

    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-exec',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });

    expect(items).toHaveLength(1);
    const a = items[0]!;
    expect(a.source).toBe('progress_draft');
    expect(a.resourceType).toBe('issue_progress_update');
    expect(a.title).toContain('Подготовить договор с клиентом Гамма');
    expect(a.title).toContain('Кора собрала черновик прогресса');
    expect(a.actionUrl).toBe('/issues/iss-1');
    expect(a.canQuickConfirm).toBe(true);
    expect(a.severity).toBe('urgent'); // age 7 >= 5
    expect(a.detail).toMatchObject({
      kind: 'progress_draft',
      health: 'on_track',
      taskTitle: 'Подготовить договор с клиентом Гамма',
    });
  });

  it('snooze: where исключает отложенные resourceId', async () => {
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'admin',
      snoozedResourceIds: new Set(['pu-9']),
    });
    const where = countMock.mock.calls[0]![0].where;
    expect(where.id).toEqual({ notIn: ['pu-9'] });
  });
});
