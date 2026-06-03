import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ProbePendingProvider } from './probe.provider';

/**
 * Unit-тесты ProbePendingProvider (Action Center B0).
 *
 * Покрытие:
 *   - count/list фильтрует по recipientUserId + eventType='probe.question'
 *     + responseStatus='pending' (любая роль — свои вопросы);
 *   - snoozed исключается;
 *   - severity urgent по просроченному expiresAt.
 */
describe('ProbePendingProvider (B0)', () => {
  let prisma: PrismaService;
  let provider: ProbePendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn();
    findManyMock = vi.fn();
    prisma = {
      notification: { count: countMock, findMany: findManyMock },
    } as unknown as PrismaService;
    provider = new ProbePendingProvider(prisma);
  });

  it('count: фильтр по recipient + probe.question + pending (любая роль)', async () => {
    countMock.mockResolvedValue(2);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: null,
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(2);
    const where = countMock.mock.calls[0]![0].where;
    expect(where.recipientUserId).toBe('u-1');
    expect(where.eventType).toBe('probe.question');
    expect(where.responseStatus).toBe('pending');
  });

  it('snoozed исключается через id.notIn', async () => {
    countMock.mockResolvedValue(0);
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: null,
      snoozedResourceIds: new Set(['nt-1']),
    });
    expect(countMock.mock.calls[0]![0].where.id).toEqual({ notIn: ['nt-1'] });
  });

  it('list: severity urgent по просроченному expiresAt; actionUrl /feed/probe-questions', async () => {
    const past = new Date(Date.now() - 60_000);
    findManyMock.mockResolvedValue([
      { id: 'nt-9', expiresAt: past, createdAt: new Date() },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.severity).toBe('urgent');
    expect(items[0]!.canQuickConfirm).toBe(false);
    expect(items[0]!.actionUrl).toBe('/feed/probe-questions');
    expect(items[0]!.resourceId).toBe('nt-9');
  });

  it('list: без expiry → normal', async () => {
    findManyMock.mockResolvedValue([
      { id: 'nt-10', expiresAt: null, createdAt: new Date() },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.severity).toBe('normal');
  });
});
