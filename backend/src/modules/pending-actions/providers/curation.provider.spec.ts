import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { CurationPendingProvider } from './curation.provider';

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
 * Unit-тесты CurationPendingProvider (Action Center B0).
 *
 * Покрытие:
 *   - candidate (член без привилегий) видит свои pending → OR-фильтр;
 *   - owner — все pending (без OR);
 *   - посторонний (member, не candidate) → 0;
 *   - snoozed исключается (notIn);
 *   - severity urgent по просроченному expiresAt и по ageDays >= 5;
 *   - canQuickConfirm = (level === 'light').
 */
describe('CurationPendingProvider (B0)', () => {
  let prisma: PrismaService;
  let provider: CurationPendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn();
    findManyMock = vi.fn();
    prisma = {
      curationItem: { count: countMock, findMany: findManyMock },
    } as unknown as PrismaService;
    provider = new CurationPendingProvider(prisma, makeCfg());
  });

  it('candidate: count использует OR (assignedTo / candidateCuratorIds)', async () => {
    countMock.mockResolvedValue(2);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'manager',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(2);
    const where = countMock.mock.calls[0]![0].where;
    expect(where.status).toBe('pending');
    expect(where.OR).toEqual([
      { assignedToUserId: 'u-1' },
      { candidateCuratorIds: { has: 'u-1' } },
    ]);
  });

  it('owner: count без OR (видит все pending)', async () => {
    countMock.mockResolvedValue(5);
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      snoozedResourceIds: new Set(),
    });
    const where = countMock.mock.calls[0]![0].where;
    expect(where.OR).toBeUndefined();
  });

  it('посторонний member: OR ограничивает выдачу — count=0 если нет своих', async () => {
    countMock.mockResolvedValue(0);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-stranger',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(0);
    expect(countMock.mock.calls[0]![0].where.OR).toBeDefined();
  });

  it('snoozed исключается через id.notIn', async () => {
    countMock.mockResolvedValue(0);
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      snoozedResourceIds: new Set(['ci-9']),
    });
    expect(countMock.mock.calls[0]![0].where.id).toEqual({ notIn: ['ci-9'] });
  });

  it('list: severity urgent по просроченному expiresAt; canQuickConfirm по level', async () => {
    const past = new Date(Date.now() - 60_000);
    findManyMock.mockResolvedValue([
      {
        id: 'ci-1',
        resourceType: 'regulation',
        resourceId: 'reg-1',
        level: 'light',
        expiresAt: past,
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
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe('urgent');
    expect(items[0]!.canQuickConfirm).toBe(true);
    expect(items[0]!.resourceId).toBe('ci-1');
    expect(items[0]!.actionUrl).toBe('/curation/ci-1');
  });

  it('list: severity urgent по ageDays >= 5; deep → canQuickConfirm=false', async () => {
    const old = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([
      {
        id: 'ci-2',
        resourceType: 'process',
        resourceId: 'proc-1',
        level: 'deep',
        expiresAt: null,
        createdAt: old,
      },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.severity).toBe('urgent');
    expect(items[0]!.ageDays).toBeGreaterThanOrEqual(5);
    expect(items[0]!.canQuickConfirm).toBe(false);
  });

  it('крутилка urgentAgeDays=10: item возрастом 7 дней → normal (при дефолте 5 был бы urgent)', async () => {
    const sevenDaysOld = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const row = {
      id: 'ci-age7',
      resourceType: 'process',
      resourceId: 'proc-7',
      level: 'deep',
      expiresAt: null, // нет expiry → severity определяется только возрастом
      createdAt: sevenDaysOld,
    };
    findManyMock.mockResolvedValue([row]);
    const args = {
      tenantId: 't-1',
      userId: 'u-1',
      role: 'owner',
      limit: 50,
      snoozedResourceIds: new Set<string>(),
    };

    // При urgentAgeDays=10 — 7 < 10 → normal.
    const raised = new CurationPendingProvider(prisma, makeCfg({ urgentAgeDays: 10 }));
    const raisedItems = await raised.listForUser(args);
    expect(raisedItems[0]!.ageDays).toBeGreaterThanOrEqual(7);
    expect(raisedItems[0]!.severity).toBe('normal');

    // Контроль: при дефолте 5 — 7 >= 5 → urgent.
    const defaultProvider = new CurationPendingProvider(prisma, makeCfg());
    const defaultItems = await defaultProvider.listForUser(args);
    expect(defaultItems[0]!.severity).toBe('urgent');
  });

  it('list (B5): expiresAt в пределах LEAD_DAYS → urgent (скоро истечёт)', async () => {
    // expiresAt через 2 дня (< LEAD_DAYS=3), карточка свежая → urgent.
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([
      {
        id: 'ci-soon',
        resourceType: 'regulation',
        resourceId: 'reg-2',
        level: 'light',
        expiresAt: soon,
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
    expect(items[0]!.severity).toBe('urgent');
  });

  it('list (B5): expiresAt дальше LEAD_DAYS и ageDays<5 → normal', async () => {
    // expiresAt через 10 дней (> LEAD_DAYS), свежая (ageDays=0) → normal.
    const far = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([
      {
        id: 'ci-far',
        resourceType: 'process',
        resourceId: 'proc-2',
        level: 'deep',
        expiresAt: far,
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
    expect(items[0]!.severity).toBe('normal');
  });

  it('list: свежий light без expiry → normal', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'ci-3',
        resourceType: 'note',
        resourceId: 'n-1',
        level: 'light',
        expiresAt: null,
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
    expect(items[0]!.severity).toBe('normal');
  });
});
