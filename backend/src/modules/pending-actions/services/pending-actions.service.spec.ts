import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { ConflictService } from '../../curation/services/conflict.service';
import type { CurationService } from '../../curation/services/curation.service';
import type { IntakeService } from '../../tracker/services/intake.service';
import type { ConflictPendingProvider } from '../providers/conflict.provider';
import type { CurationPendingProvider } from '../providers/curation.provider';
import type { IntakePendingProvider } from '../providers/intake.provider';
import type { PendingActionItem } from '../providers/pending-actions-provider.types';
import type { ProbePendingProvider } from '../providers/probe.provider';

import { PendingActionsService } from './pending-actions.service';

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
  let curationService: CurationService;
  let conflictService: ConflictService;
  let intakeService: IntakeService;
  let conversational: ConversationalService;
  let curationItemFindUnique: ReturnType<typeof vi.fn>;
  let decide: ReturnType<typeof vi.fn>;
  let resolveConflict: ReturnType<typeof vi.fn>;
  let triage: ReturnType<typeof vi.fn>;
  let respondToProbe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    membershipFindUnique = vi.fn().mockResolvedValue({ role: 'owner' });
    snoozeFindMany = vi.fn().mockResolvedValue([]);
    snoozeUpsert = vi.fn().mockResolvedValue({});
    curationItemFindUnique = vi.fn().mockResolvedValue(null);
    prisma = {
      membership: { findUnique: membershipFindUnique },
      pendingActionSnooze: { findMany: snoozeFindMany, upsert: snoozeUpsert },
      curationItem: { findUnique: curationItemFindUnique },
    } as unknown as PrismaService;

    decide = vi.fn().mockResolvedValue({ id: 'ci-1', status: 'decided' });
    curationService = { decide } as unknown as CurationService;
    resolveConflict = vi.fn().mockResolvedValue({ id: 'cf-1', status: 'resolved' });
    conflictService = { resolve: resolveConflict } as unknown as ConflictService;
    triage = vi.fn().mockResolvedValue({ intake: { id: 'ii-1' }, createdIssue: null });
    intakeService = { triage } as unknown as IntakeService;
    respondToProbe = vi.fn().mockResolvedValue({ id: 'nt-1', responseStatus: 'answered' });
    conversational = {
      respondToProbe,
    } as unknown as ConversationalService;

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

    svc = new PendingActionsService(
      prisma,
      curation,
      conflict,
      intake,
      probe,
      curationService,
      conflictService,
      intakeService,
      conversational,
    );
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

    const curationArgs = (curation.countForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(curationArgs.role).toBe('manager');
    expect([...curationArgs.snoozedResourceIds]).toEqual(['ci-1']);

    const probeArgs = (probe.countForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect([...probeArgs.snoozedResourceIds]).toEqual(['nt-1']);
  });

  it('getCount: не член Org → role=null', async () => {
    membershipFindUnique.mockResolvedValue(null);
    await svc.getCount({ tenantId: 't-1', userId: 'u-x' });
    const args = (curation.countForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
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
    expect(items.map((i) => i.resourceId)).toEqual(['c', 'b', 'a']);
  });

  it('getList: передаёт limit и snoozed-сет провайдерам', async () => {
    snoozeFindMany.mockResolvedValue([{ source: 'intake', resourceId: 'ii-1' }]);
    await svc.getList({ tenantId: 't-1', userId: 'u-1', limit: 25 });
    const intakeArgs = (intake.listForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
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

  it('confirm curation: light pending → decide(approve) вызван', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-1',
      tenantId: 't-1',
      status: 'pending',
      level: 'light',
    });
    const res = await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceId: 'ci-1',
    });
    expect(res).toEqual({ ok: true });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0]).toEqual({
      tenantId: 't-1',
      curationItemId: 'ci-1',
      reviewerUserId: 'u-1',
      decisionType: 'approve',
    });
  });

  it('confirm curation: resolution=reject → decide(reject)', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-r',
      tenantId: 't-1',
      status: 'pending',
      level: 'light',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceId: 'ci-r',
      resolution: 'reject',
    });
    expect(decide.mock.calls[0]![0].decisionType).toBe('reject');
  });

  it('confirm conflict: keep_old → ConflictService.resolve(keep_old)', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'conflict',
      resourceId: 'cf-1',
      resolution: 'keep_old',
    });
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(resolveConflict.mock.calls[0]![0]).toEqual({
      tenantId: 't-1',
      conflictId: 'cf-1',
      reviewerUserId: 'u-1',
      resolution: 'keep_old',
    });
  });

  it('confirm conflict: без resolution → BadRequest, resolve не вызван', async () => {
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'conflict',
        resourceId: 'cf-2',
      }),
    ).rejects.toThrow();
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it('confirm intake: accept → IntakeService.triage(accept) c targetProjectId', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'intake',
      resourceId: 'ii-1',
      resolution: 'accept',
      targetProjectId: 'proj-1',
    });
    expect(triage).toHaveBeenCalledTimes(1);
    const [id, dto, tenantId, userId] = triage.mock.calls[0]!;
    expect(id).toBe('ii-1');
    expect(dto).toEqual({ decision: 'accept', targetProjectId: 'proj-1' });
    expect(tenantId).toBe('t-1');
    expect(userId).toBe('u-1');
  });

  it('confirm intake: reject → triage(reject), targetProjectId=null', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'intake',
      resourceId: 'ii-2',
      resolution: 'reject',
    });
    expect(triage.mock.calls[0]![1]).toEqual({
      decision: 'reject',
      targetProjectId: null,
    });
  });

  it('confirm intake: невалидный resolution → BadRequest, triage не вызван', async () => {
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'intake',
        resourceId: 'ii-3',
        resolution: 'merge',
      }),
    ).rejects.toThrow();
    expect(triage).not.toHaveBeenCalled();
  });

  it('confirm probe: answerText → respondToProbe({text})', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'probe',
      resourceId: 'nt-1',
      answerText: '  Да, согласен  ',
    });
    expect(respondToProbe).toHaveBeenCalledTimes(1);
    expect(respondToProbe.mock.calls[0]![0]).toEqual({
      notificationId: 'nt-1',
      userId: 'u-1',
      payload: { text: 'Да, согласен' },
    });
  });

  it('confirm probe: без answerText → BadRequest, respondToProbe не вызван', async () => {
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'probe',
        resourceId: 'nt-2',
      }),
    ).rejects.toThrow();
    expect(respondToProbe).not.toHaveBeenCalled();
  });

  it('confirm curation: не-light уровень → BadRequest, decide не вызван', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-2',
      tenantId: 't-1',
      status: 'pending',
      level: 'deep',
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-2',
      }),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it('confirm: чужой tenant / не найден → BadRequest', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-3',
      tenantId: 'other',
      status: 'pending',
      level: 'light',
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-3',
      }),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it('confirm: не pending → BadRequest', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-4',
      tenantId: 't-1',
      status: 'decided',
      level: 'light',
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-4',
      }),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it('confirm: Forbidden из decide пробрасывается наружу (RBAC)', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-5',
      tenantId: 't-1',
      status: 'pending',
      level: 'light',
    });
    decide.mockRejectedValue(new Error('not_in_candidates'));
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-5',
      }),
    ).rejects.toThrow();
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
