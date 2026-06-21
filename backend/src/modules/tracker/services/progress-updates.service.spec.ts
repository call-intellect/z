import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProgressUpdatesService } from './progress-updates.service';

type Row = Record<string, unknown>;

function makeRow(over: Row = {}): Row {
  return {
    id: 'pu1',
    tenantId: 't1',
    issueId: 'i1',
    authorId: null,
    authorType: 'ai_agent',
    health: 'on_track',
    body: 'черновик',
    doneText: null,
    nextText: null,
    draftState: 'pending',
    sourceBlockIds: [],
    evidenceQuote: null,
    confidence: null,
    previewQuote: null,
    previewSourceRef: null,
    periodStart: null,
    periodEnd: null,
    createdAt: new Date('2026-06-21T00:00:00Z'),
    updatedAt: new Date('2026-06-21T00:00:00Z'),
    deletedAt: null,
    ...over,
  };
}

function build() {
  const store = { row: makeRow() };
  const txClient = {
    issueProgressUpdate: {
      create: vi.fn(async ({ data }: { data: Row }) =>
        makeRow({ ...data, id: 'created1' }),
    ),
      update: vi.fn(async ({ data }: { data: Row }) =>
        makeRow({ ...store.row, ...data }),
      ),
    },
  };
  const prisma = {
    issueProgressUpdate: {
      findMany: vi.fn(async () => [makeRow()]),
      findUnique: vi.fn(async () => store.row),
      update: vi.fn(async ({ data }: { data: Row }) =>
        makeRow({ ...store.row, ...data }),
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txClient)),
  };
  const activity = { record: vi.fn(async () => 'a1') };
  const issues = { requireIssue: vi.fn(async () => ({ id: 'i1' })) };
  const svc = new ProgressUpdatesService(
    prisma as never,
    activity as never,
    issues as never,
  );
  return { svc, prisma, activity, issues, txClient, store };
}

describe('ProgressUpdatesService', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('create — публикует human-обновление (draftState=null) и пишет activity', async () => {
    const res = await ctx.svc.create(
      'i1',
      { health: 'at_risk', body: 'сделал X' },
      't1',
      'u1',
    );
    expect(res.authorType).toBe('human');
    expect(res.authorId).toBe('u1');
    expect(res.draftState).toBeNull();
    expect(ctx.activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'progress_updated', actorType: 'user' }),
    );
  });

  it('confirm без правок — pending→accepted, проставляет authorId', async () => {
    const res = await ctx.svc.confirm('pu1', {}, 't1', 'u1');
    expect(res.draftState).toBe('accepted');
    expect(res.authorId).toBe('u1');
  });

  it('confirm с правкой body — pending→edited', async () => {
    const res = await ctx.svc.confirm(
      'pu1',
      { body: 'поправил' },
      't1',
      'u1',
    );
    expect(res.draftState).toBe('edited');
  });

  it('confirm не-pending → forbidden', async () => {
    ctx.store.row = makeRow({ draftState: 'accepted' });
    await expect(ctx.svc.confirm('pu1', {}, 't1', 'u1')).rejects.toThrow();
  });

  it('update чужим автором → forbidden', async () => {
    ctx.store.row = makeRow({ authorId: 'other', draftState: null });
    await expect(
      ctx.svc.update('pu1', { body: 'edit' }, 't1', 'u1'),
    ).rejects.toThrow();
  });

  it('requireUpdate чужой tenant → not found', async () => {
    ctx.store.row = makeRow({ tenantId: 'other' });
    await expect(ctx.svc.softDelete('pu1', 't1', 'u1', false)).rejects.toThrow();
  });
});
