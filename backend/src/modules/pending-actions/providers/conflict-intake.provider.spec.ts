import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ConflictPendingProvider } from './conflict.provider';
import { IntakePendingProvider } from './intake.provider';

/**
 * Unit-тесты ConflictPendingProvider / IntakePendingProvider (Action Center B0).
 *
 * Покрытие:
 *   - только owner/admin видят items; member → 0/[];
 *   - snoozed исключается;
 *   - severity urgent по ageDays >= 5.
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
    provider = new ConflictPendingProvider(prisma);
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

  it('list: severity urgent по ageDays >= 5; canQuickConfirm=false', async () => {
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
    expect(items[0]!.actionUrl).toBe('/curation');
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
    provider = new IntakePendingProvider(prisma);
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
