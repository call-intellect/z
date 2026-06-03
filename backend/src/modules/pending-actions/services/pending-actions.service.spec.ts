import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConflictPendingProvider } from '../providers/conflict.provider';
import type { CurationPendingProvider } from '../providers/curation.provider';
import type { IntakePendingProvider } from '../providers/intake.provider';
import type { PendingActionItem } from '../providers/pending-actions-provider.types';
import type { ProbePendingProvider } from '../providers/probe.provider';

import { PendingActionsService } from './pending-actions.service';

/**
 * Unit-тесты PendingActionsService (Action Center B0).
 *
 * Покрытие:
 *   - getCount: total = сумма bySource; роль резолвится из Membership;
 *     snoozed-сет передаётся провайдерам по source;
 *   - getList: объединение, сортировка urgent-first → ageDays desc, limit;
 *   - snooze: upsert PendingActionSnooze + валидация hours (1..720).
 */

function item(
  source: PendingActionItem['source'],
  over: Partial<PendingActionItem> = {},
): PendingActionItem {
  return {
    source,
    resourceType: 'x',
    resourceId: 'r',
    title: 't',
    severity: 'normal',
    ageDays: 0,
    actionUrl: '/x',
    canQuickConfirm: false,
    ...over,
  };
}

describe('PendingActionsService (B0)', () => {
  let prisma: PrismaService;
  let svc: PendingActionsService;
  let membershipFindUnique: ReturnType<typeof vi.fn>;
  let snoozeFindMany: ReturnType<typeof vi.fn>;
  let snoozeUpsert: ReturnType<typeof vi.fn>;

  let curation: CurationPendingProvider;
  let conflict: ConflictPendingProvider;
  let intake: IntakePendingProvider;
  let probe: ProbePendingProvider;

  beforeEach(() => {
    membershipFindUnique = vi.fn().mockResolvedValue({ role: 'owner' });
    snoozeFindMany = vi.fn().mockResolvedValue([]);
    snoozeUpsert = vi.fn().mockResolvedValue({});
    prisma = {
      membership: { findUnique: membershipFindUnique },
      pendingActionSnooze: { findMany: snoozeFindMany, upsert: snoozeUpsert },
    } as unknown as PrismaService;

    curation = {
      source: 'curation',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as CurationPendingProvider;
    conflict = {
      source: 'conflict',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as ConflictPendingProvider;
    intake = {
      source: 'intake',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as IntakePendingProvider;
    probe = {
      source: 'probe',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as ProbePendingProvider;

    svc = new PendingActionsService(prisma, curation, conflict, intake, probe);
  });

  it('getCount: total = сумма bySource', async () => {
    (curation.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (conflict.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (intake.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (probe.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(4);

    const res = await svc.getCount({ tenantId: 't-1', userId: 'u-1' });
    expect(res.bySource).toEqual({
      curation: 3,
      conflict: 1,
      intake: 2,
      probe: 4,
    });
    expect(res.total).toBe(10);
  });

  it('getCount: роль из Membership и snoozed-сет передаются провайдеру', async () => {
    membershipFindUnique.mockResolvedValue({ role: 'manager' });
    snoozeFindMany.mockResolvedValue([
      { source: 'curation', resourceId: 'ci-1' },
      { source: 'probe', resourceId: 'nt-1' },
    ]);
    await svc.getCount({ tenantId: 't-1', userId: 'u-1' });

    const curationArgs = (curation.countForUser as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(curationArgs.role).toBe('manager');
    expect([...curationArgs.snoozedResourceIds]).toEqual(['ci-1']);

    const probeArgs = (probe.countForUser as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect([...probeArgs.snoozedResourceIds]).toEqual(['nt-1']);
  });

  it('getCount: не член Org → role=null', async () => {
    membershipFindUnique.mockResolvedValue(null);
    await svc.getCount({ tenantId: 't-1', userId: 'u-x' });
    const args = (curation.countForUser as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(args.role).toBeNull();
  });

  it('getList: urgent-first, затем ageDays desc, затем limit', async () => {
    (curation.listForUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      item('curation', { resourceId: 'a', severity: 'normal', ageDays: 10 }),
      item('curation', { resourceId: 'b', severity: 'urgent', ageDays: 1 }),
    ]);
    (probe.listForUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      item('probe', { resourceId: 'c', severity: 'urgent', ageDays: 8 }),
      item('probe', { resourceId: 'd', severity: 'normal', ageDays: 2 }),
    ]);

    const { items } = await svc.getList({
      tenantId: 't-1',
      userId: 'u-1',
      limit: 3,
    });
    // urgent сначала (c[age8], b[age1]), потом normal (a[age10], d[age2]); limit=3
    expect(items.map((i) => i.resourceId)).toEqual(['c', 'b', 'a']);
  });

  it('getList: передаёт limit и snoozed-сет провайдерам', async () => {
    snoozeFindMany.mockResolvedValue([
      { source: 'intake', resourceId: 'ii-1' },
    ]);
    await svc.getList({ tenantId: 't-1', userId: 'u-1', limit: 25 });
    const intakeArgs = (intake.listForUser as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(intakeArgs.limit).toBe(25);
    expect([...intakeArgs.snoozedResourceIds]).toEqual(['ii-1']);
  });

  it('snooze: upsert с snoozedUntil = now + hours', async () => {
    const before = Date.now();
    const res = await svc.snooze({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceType: 'regulation',
      resourceId: 'ci-1',
      hours: 24,
    });
    expect(res.ok).toBe(true);
    expect(snoozeUpsert).toHaveBeenCalledTimes(1);
    const call = snoozeUpsert.mock.calls[0]![0];
    expect(call.where.tenantId_userId_source_resourceId).toEqual({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceId: 'ci-1',
    });
    const until = new Date(res.snoozedUntil).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000 - 1000);
  });

  it('snooze: hours вне [1..720] → BadRequest', async () => {
    await expect(
      svc.snooze({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceType: 'x',
        resourceId: 'r',
        hours: 0,
      }),
    ).rejects.toThrow();
    await expect(
      svc.snooze({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceType: 'x',
        resourceId: 'r',
        hours: 721,
      }),
    ).rejects.toThrow();
    expect(snoozeUpsert).not.toHaveBeenCalled();
  });
});
