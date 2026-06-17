import { describe, expect, it, vi } from 'vitest';

import { TaskReconcileService } from './task-reconcile.service';

/**
 * TZ task-dedup (2026-06-16, Ф3) — TaskReconcileService unit-тесты.
 *
 * Acceptance §10 Ф3 (mocked Prisma):
 *   1. pending старше TTL → expired (condition-UPDATE WHERE status='pending');
 *   2. смоделированный reopen → попал в reopen-rate/метрику;
 *   3. повторный прогон = no-op (идемпотентность — те же condition-UPDATE);
 *   4. подбор пропущенных матчей → переэмит task.completion_signalled.
 */
describe('TaskReconcileService', () => {
  function build(overrides: {
    expireCount?: number;
    accepted?: Array<{ id: string; issueId: string; decidedAt: Date | null }>;
    /** issueId → задача снова открыта (completedAt=null). */
    openIssueIds?: Set<string>;
    /** issueId → есть status_changed после decidedAt. */
    reopenActivityIssueIds?: Set<string>;
    missedBlocks?: Array<{ id: string; signalType: string }>;
    coveredBlockIds?: string[];
    reopenRateAlert?: number;
    withEventEmitter?: boolean;
  }) {
    const updateMany = vi
      .fn()
      .mockResolvedValue({ count: overrides.expireCount ?? 0 });
    const candidateFindMany = vi.fn().mockImplementation(({ where }) => {
      // status='accepted' → reopen-расчёт; иначе covered-блоки для подбора.
      if (where?.status === 'accepted') {
        return Promise.resolve(overrides.accepted ?? []);
      }
      return Promise.resolve(
        (overrides.coveredBlockIds ?? []).map((id) => ({ sourceBlockId: id })),
      );
    });

    const issueFindFirst = vi.fn().mockImplementation(({ where }) => {
      const open = overrides.openIssueIds ?? new Set<string>();
      return Promise.resolve(open.has(where.id) ? { id: where.id } : null);
    });
    const issueActivityFindFirst = vi.fn().mockImplementation(({ where }) => {
      const reopened = overrides.reopenActivityIssueIds ?? new Set<string>();
      return Promise.resolve(reopened.has(where.issueId) ? { id: 'act-1' } : null);
    });

    const ideaBlockFindMany = vi
      .fn()
      .mockResolvedValue(overrides.missedBlocks ?? []);
    const ideaBlockEvidenceFindFirst = vi
      .fn()
      .mockResolvedValue({ sourceType: 'meeting' });

    const prisma = {
      taskClosureCandidate: { updateMany, findMany: candidateFindMany },
      issue: { findFirst: issueFindFirst },
      issueActivity: { findFirst: issueActivityFindFirst },
      ideaBlock: { findMany: ideaBlockFindMany },
      ideaBlockEvidence: { findFirst: ideaBlockEvidenceFindFirst },
    };

    const setTaskClosureReopenRate = vi.fn();
    const metrics = { setTaskClosureReopenRate };

    const settings = {
      get: vi.fn().mockResolvedValue(overrides.reopenRateAlert),
    };

    const emit = vi.fn();
    const eventEmitter = overrides.withEventEmitter ? { emit } : null;

    const svc = new TaskReconcileService(
      prisma as never,
      metrics as never,
      settings as never,
      eventEmitter as never,
    );
    return {
      svc,
      updateMany,
      candidateFindMany,
      setTaskClosureReopenRate,
      emit,
      ideaBlockFindMany,
    };
  }

  it('pending старше TTL → expired (condition-UPDATE WHERE status=pending)', async () => {
    const { svc, updateMany } = build({ expireCount: 3 });
    const now = new Date('2026-06-17T03:00:00Z');
    const res = await svc.reconcileForTenant({ tenantId: 't1', now });
    expect(res.expired).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0]![0];
    // Идемпотентность: WHERE status='pending' + expiresAt < now.
    expect(call.where.status).toBe('pending');
    expect(call.where.tenantId).toBe('t1');
    expect(call.where.expiresAt).toEqual({ not: null, lt: now });
    expect(call.data.status).toBe('expired');
  });

  it('смоделированный reopen → попал в reopen-rate + метрику', async () => {
    const decidedAt = new Date('2026-06-01T00:00:00Z');
    const { svc, setTaskClosureReopenRate } = build({
      accepted: [
        { id: 'c1', issueId: 'iss-1', decidedAt },
        { id: 'c2', issueId: 'iss-2', decidedAt },
      ],
      // iss-1 снова открыта + есть status_changed после accept → reopen.
      openIssueIds: new Set(['iss-1']),
      reopenActivityIssueIds: new Set(['iss-1']),
    });
    const res = await svc.reconcileForTenant({
      tenantId: 't1',
      now: new Date('2026-06-17T03:00:00Z'),
    });
    expect(res.acceptedTotal).toBe(2);
    expect(res.reopened).toBe(1);
    expect(res.reopenRate).toBeCloseTo(0.5, 5);
    expect(setTaskClosureReopenRate).toHaveBeenCalledTimes(1);
    expect(setTaskClosureReopenRate.mock.calls[0]![0].value).toBeCloseTo(0.5, 5);
  });

  it('reopen только при completedAt=null И status_changed после accept', async () => {
    const decidedAt = new Date('2026-06-01T00:00:00Z');
    const { svc } = build({
      accepted: [{ id: 'c1', issueId: 'iss-1', decidedAt }],
      // задача открыта, НО нет status_changed после accept → не reopen.
      openIssueIds: new Set(['iss-1']),
      reopenActivityIssueIds: new Set<string>(),
    });
    const res = await svc.reconcileForTenant({
      tenantId: 't1',
      now: new Date('2026-06-17T03:00:00Z'),
    });
    expect(res.reopened).toBe(0);
    expect(res.reopenRate).toBe(0);
  });

  it('подбор пропущенных матчей → переэмит task.completion_signalled', async () => {
    const { svc, emit } = build({
      withEventEmitter: true,
      missedBlocks: [
        { id: 'blk-1', signalType: 'task_completed' },
        { id: 'blk-2', signalType: 'done_item' },
      ],
    });
    const res = await svc.reconcileForTenant({
      tenantId: 't1',
      now: new Date('2026-06-17T03:00:00Z'),
    });
    expect(res.reEmitted).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]![0]).toBe('task.completion_signalled');
    expect(emit.mock.calls[0]![1]).toMatchObject({
      tenantId: 't1',
      blockId: 'blk-1',
      signalType: 'task_completed',
      sourceType: 'meeting',
    });
  });

  it('без event-bus подбор матчей пропускается (reEmitted=0)', async () => {
    const { svc, ideaBlockFindMany } = build({
      withEventEmitter: false,
      missedBlocks: [{ id: 'blk-1', signalType: 'task_completed' }],
    });
    const res = await svc.reconcileForTenant({
      tenantId: 't1',
      now: new Date(),
    });
    expect(res.reEmitted).toBe(0);
    expect(ideaBlockFindMany).not.toHaveBeenCalled();
  });

  it('повторный прогон с тем же now = тот же результат (идемпотентность)', async () => {
    const decidedAt = new Date('2026-06-01T00:00:00Z');
    const { svc, updateMany } = build({
      expireCount: 0, // повторно протухать нечего (уже expired)
      accepted: [{ id: 'c1', issueId: 'iss-1', decidedAt }],
      openIssueIds: new Set<string>(),
    });
    const now = new Date('2026-06-17T03:00:00Z');
    const a = await svc.reconcileForTenant({ tenantId: 't1', now });
    const b = await svc.reconcileForTenant({ tenantId: 't1', now });
    expect(a).toEqual(b);
    // оба прогона делают тот же condition-UPDATE (no-op при count=0).
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
