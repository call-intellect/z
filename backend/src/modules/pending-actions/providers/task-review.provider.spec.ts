import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TaskReviewPendingProvider } from './task-review.provider';

/**
 * Unit-тесты TaskReviewPendingProvider (TZ task-dedup, 2026-06-16, Ф4, R11).
 *
 * Покрытие:
 *   - только owner/admin видят items; member → 0/[];
 *   - читаются Issue с `closureReviewState IS NOT NULL` (+ deletedAt=null);
 *   - severity urgent по ageDays (от closureReviewAt) >= urgentAgeDays;
 *   - canQuickConfirm=true (снятие пометки — один клик, необратимого нет);
 *   - title человеческий, detail.reason = closureReviewReason.
 */
function makeCfg(urgentAgeDays = 5): TypedConfigService {
  return {
    pendingActions: {
      reminderWindowStartHour: 9,
      reminderWindowEndHour: 21,
      reminderStepHours: 3,
      urgentAgeDays,
      reminderLeadDays: 3,
    },
  } as unknown as TypedConfigService;
}

describe('TaskReviewPendingProvider (Ф4)', () => {
  let prisma: PrismaService;
  let provider: TaskReviewPendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn().mockResolvedValue(0);
    findManyMock = vi.fn().mockResolvedValue([]);
    prisma = {
      issue: { count: countMock, findMany: findManyMock },
    } as unknown as PrismaService;
    provider = new TaskReviewPendingProvider(prisma, makeCfg());
  });

  it('member: count=0 без обращения к БД', async () => {
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(0);
    expect(countMock).not.toHaveBeenCalled();
  });

  it('owner: count читает Issue с closureReviewState != null, deletedAt=null', async () => {
    countMock.mockResolvedValue(2);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(2);
    const where = countMock.mock.calls[0]![0].where;
    expect(where.closureReviewState).toEqual({ not: null });
    expect(where.deletedAt).toBeNull();
    expect(where.tenantId).toBe('t-1');
  });

  it('list: review-задачи показаны, title человеческий, canQuickConfirm=true', async () => {
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([
      {
        id: 'iss-1',
        title: 'Внедрить CRM X',
        closureReviewReason: 'Решение заменено новым — проверьте актуальность.',
        closureReviewAt: old,
        createdAt: old,
      },
      {
        id: 'iss-2',
        title: 'Подготовить отчёт',
        closureReviewReason: null,
        closureReviewAt: new Date(),
        createdAt: new Date(),
      },
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
    expect(a.source).toBe('task_review');
    expect(a.resourceType).toBe('issue_review');
    expect(a.resourceId).toBe('iss-1');
    expect(a.title).toContain('Внедрить CRM X');
    expect(a.severity).toBe('urgent'); // age 7 >= 5
    expect(a.canQuickConfirm).toBe(true);
    expect(a.detail).toEqual(
      expect.objectContaining({
        kind: 'task_review',
        taskTitle: 'Внедрить CRM X',
        reason: 'Решение заменено новым — проверьте актуальность.',
      }),
    );
    const b = items[1]!;
    expect(b.severity).toBe('normal');
  });

  it('list: snooze исключает отложенные resourceId', async () => {
    findManyMock.mockResolvedValue([]);
    await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'admin',
      limit: 50,
      snoozedResourceIds: new Set(['iss-9']),
    });
    const where = findManyMock.mock.calls[0]![0].where;
    expect(where.id).toEqual({ notIn: ['iss-9'] });
  });
});
