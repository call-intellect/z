import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TaskClosurePendingProvider } from './task-closure.provider';

/**
 * Unit-тесты TaskClosurePendingProvider (TZ task-dedup, 2026-06-16, Ф2).
 *
 * Покрытие:
 *   - только owner/admin видят items; member → 0/[];
 *   - severity urgent по ageDays >= urgentAgeDays;
 *   - canQuickConfirm=true при confidence >= autoConfirmThreshold;
 *   - заголовок задачи резолвится (issueId → Issue.title), title человеческий.
 */
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

describe('TaskClosurePendingProvider (Ф2)', () => {
  let prisma: PrismaService;
  let provider: TaskClosurePendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;
  let issueFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn().mockResolvedValue(0);
    findManyMock = vi.fn().mockResolvedValue([]);
    issueFindMany = vi.fn().mockResolvedValue([]);
    prisma = {
      taskClosureCandidate: { count: countMock, findMany: findManyMock },
      issue: { findMany: issueFindMany },
    } as unknown as PrismaService;
    provider = new TaskClosurePendingProvider(prisma, makeCfg());
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

  it('owner: count обращается к БД (status=pending)', async () => {
    countMock.mockResolvedValue(3);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(3);
    expect(countMock.mock.calls[0]![0].where.status).toBe('pending');
  });

  it('list: резолвит заголовок задачи, canQuickConfirm по confidence', async () => {
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
    expect(a.severity).toBe('urgent'); // age 7 >= 5
    expect(a.canQuickConfirm).toBe(true); // 0.97 >= 0.95
    const b = items[1]!;
    expect(b.severity).toBe('normal');
    expect(b.canQuickConfirm).toBe(false); // 0.80 < 0.95
  });
});
