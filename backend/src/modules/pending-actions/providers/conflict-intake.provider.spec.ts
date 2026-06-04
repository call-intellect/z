import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ConflictPendingProvider } from './conflict.provider';
import { IntakePendingProvider } from './intake.provider';

/**
 * Заглушка TypedConfigService: геттер `pendingActions` отдаёт дефолты
 * (urgentAgeDays=5, reminderLeadDays=3). `overrides` меняет крутилки в
 * отдельном тесте.
 */
function makeCfg(
  overrides: Partial<{ urgentAgeDays: number; reminderLeadDays: number }> = {},
): TypedConfigService {
  return {
    pendingActions: {
      reminderWindowStartHour: 9,
      reminderWindowEndHour: 21,
      reminderStepHours: 3,
      urgentAgeDays: 5,
      reminderLeadDays: 3,
      ...overrides,
    },
  } as unknown as TypedConfigService;
}

/**
 * Unit-тесты ConflictPendingProvider / IntakePendingProvider (Action Center B0).
 *
 * Покрытие:
 *   - только owner/admin видят items; member → 0/[];
 *   - snoozed исключается;
 *   - severity urgent по ageDays >= cfg.pendingActions.urgentAgeDays (дефолт 5);
 *   - крутилка urgentAgeDays переопределяет порог (C2).
 */
describe('ConflictPendingProvider (B0)', () => {
  let prisma: PrismaService;
  let provider: ConflictPendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn();
    findManyMock = vi.fn();
    prisma = {
      conflictItem: { count: countMock, findMany: findManyMock },
    } as unknown as PrismaService;
    provider = new ConflictPendingProvider(prisma, makeCfg());
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

  it('member: list=[] без обращения к БД', async () => {
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('admin: count обращается к open-конфликтам', async () => {
    countMock.mockResolvedValue(3);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(3);
    expect(countMock.mock.calls[0]![0].where.status).toBe('open');
  });

  it('snoozed исключается через id.notIn', async () => {
    countMock.mockResolvedValue(0);
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      snoozedResourceIds: new Set(['cf-1']),
    });
    expect(countMock.mock.calls[0]![0].where.id).toEqual({ notIn: ['cf-1'] });
  });

  it('list: severity urgent по ageDays >= urgentAgeDays (дефолт 5); canQuickConfirm=false', async () => {
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([
      { id: 'cf-9', resourceType: 'decision', createdAt: old },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.severity).toBe('urgent');
    expect(items[0]!.canQuickConfirm).toBe(false);
    expect(items[0]!.actionUrl).toBe('/curation/conflicts/cf-9');
  });

  it('крутилка urgentAgeDays=10: конфликт возрастом 7 дней → normal (при дефолте 5 был бы urgent)', async () => {
    const sevenDaysOld = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const row = { id: 'cf-age7', resourceType: 'decision', createdAt: sevenDaysOld };
    findManyMock.mockResolvedValue([row]);
    const args = {
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin' as const,
      limit: 50,
      snoozedResourceIds: new Set<string>(),
    };

    // При urgentAgeDays=10 — 7 < 10 → normal.
    const raised = new ConflictPendingProvider(prisma, makeCfg({ urgentAgeDays: 10 }));
    const raisedItems = await raised.listForUser(args);
    expect(raisedItems[0]!.ageDays).toBeGreaterThanOrEqual(7);
    expect(raisedItems[0]!.severity).toBe('normal');

    // Контроль: при дефолте 5 — 7 >= 5 → urgent.
    const defaultProvider = new ConflictPendingProvider(prisma, makeCfg());
    const defaultItems = await defaultProvider.listForUser(args);
    expect(defaultItems[0]!.severity).toBe('urgent');
  });
});

describe('IntakePendingProvider (B0)', () => {
  let prisma: PrismaService;
  let provider: IntakePendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn();
    findManyMock = vi.fn();
    prisma = {
      intakeIssue: { count: countMock, findMany: findManyMock },
    } as unknown as PrismaService;
    provider = new IntakePendingProvider(prisma, makeCfg());
  });

  it('member: count=0, list=[] без обращения к БД', async () => {
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(0);
    expect(items).toEqual([]);
    expect(countMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('owner: count по status=pending', async () => {
    countMock.mockResolvedValue(4);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(4);
    expect(countMock.mock.calls[0]![0].where.status).toBe('pending');
  });

  it('list: title из extractedTitle, actionUrl /intake', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'ii-1',
        extractedTitle: 'Починить биллинг',
        rawContent: 'сырой текст',
        createdAt: new Date(),
      },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.title).toContain('Починить биллинг');
    expect(items[0]!.actionUrl).toBe('/intake');
    expect(items[0]!.resourceType).toBe('intake_issue');
  });
});
