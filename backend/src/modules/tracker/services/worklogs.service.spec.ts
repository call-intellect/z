import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WorklogsService } from './worklogs.service';

type Row = Record<string, unknown>;

function makeRow(over: Row = {}): Row {
  return {
    id: 'wl1',
    tenantId: 't1',
    issueId: 'i1',
    userId: 'u1',
    minutes: 30,
    description: null,
    startedAt: new Date('2026-06-21T00:00:00Z'),
    createdAt: new Date('2026-06-21T00:00:00Z'),
    ...over,
  };
}

function build(opts: { timeTrackingEnabled: boolean }) {
  const store = { worklog: makeRow() as Row };
  const txClient = {
    issueWorklog: {
      create: vi.fn(async ({ data }: { data: Row }) =>
        makeRow({ ...data, id: 'created1' }),
      ),
    },
  };
  const prisma = {
    issueWorklog: {
      findMany: vi.fn(async () => [makeRow({ minutes: 30 }), makeRow({ id: 'wl2', minutes: 45 })]),
      findUnique: vi.fn(async () => store.worklog),
      delete: vi.fn(async () => store.worklog),
    },
    project: {
      findUnique: vi.fn(async () => ({
        timeTrackingEnabled: opts.timeTrackingEnabled,
      })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txClient)),
  };
  const activity = { record: vi.fn(async () => 'a1') };
  const issues = {
    requireIssue: vi.fn(async () => ({ id: 'i1', projectId: 'p1' })),
  };
  const svc = new WorklogsService(
    prisma as never,
    activity as never,
    issues as never,
  );
  return { svc, prisma, activity, issues, txClient, store };
}

describe('WorklogsService', () => {
  describe('флаг проекта timeTrackingEnabled выключен', () => {
    let ctx: ReturnType<typeof build>;
    beforeEach(() => {
      ctx = build({ timeTrackingEnabled: false });
    });

    it('create → 403 time_tracking_disabled', async () => {
      await expect(
        ctx.svc.create(
          'i1',
          { minutes: 30, startedAt: '2026-06-21T00:00:00Z' },
          't1',
          'u1',
        ),
      ).rejects.toMatchObject({
        response: { error: { code: 'time_tracking_disabled' } },
      });
      expect(ctx.txClient.issueWorklog.create).not.toHaveBeenCalled();
    });

    it('list → 403 time_tracking_disabled', async () => {
      await expect(ctx.svc.listByIssue('i1', 't1')).rejects.toMatchObject({
        response: { error: { code: 'time_tracking_disabled' } },
      });
    });
  });

  describe('флаг проекта timeTrackingEnabled включён', () => {
    let ctx: ReturnType<typeof build>;
    beforeEach(() => {
      ctx = build({ timeTrackingEnabled: true });
    });

    it('create — пишет лог + activity verb=time_logged', async () => {
      const res = await ctx.svc.create(
        'i1',
        { minutes: 45, startedAt: '2026-06-21T00:00:00Z', description: 'правки' },
        't1',
        'u1',
      );
      expect(res.minutes).toBe(45);
      expect(res.userId).toBe('u1');
      expect(ctx.activity.record).toHaveBeenCalledWith(
        expect.objectContaining({ verb: 'time_logged', actorType: 'user' }),
      );
    });

    it('list — отдаёт сумму минут по задаче', async () => {
      const res = await ctx.svc.listByIssue('i1', 't1');
      expect(res.items).toHaveLength(2);
      expect(res.totalMinutes).toBe(75);
    });

    it('remove чужим не-админом → forbidden', async () => {
      ctx.store.worklog = makeRow({ userId: 'other' });
      await expect(
        ctx.svc.remove('wl1', 't1', 'u1', false),
      ).rejects.toMatchObject({
        response: { error: { code: 'forbidden' } },
      });
    });

    it('remove админом чужой записи → ok', async () => {
      ctx.store.worklog = makeRow({ userId: 'other' });
      const res = await ctx.svc.remove('wl1', 't1', 'u1', true);
      expect(res.ok).toBe(true);
    });

    it('remove чужой tenant → not found', async () => {
      ctx.store.worklog = makeRow({ tenantId: 'other' });
      await expect(
        ctx.svc.remove('wl1', 't1', 'u1', true),
      ).rejects.toMatchObject({
        response: { error: { code: 'worklog_not_found' } },
      });
    });
  });
});
