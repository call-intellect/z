import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { CurationPendingProvider } from './curation.provider';

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
    provider = new CurationPendingProvider(prisma);
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
    expect(items[0]!.actionUrl).toBe('/curation');
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
