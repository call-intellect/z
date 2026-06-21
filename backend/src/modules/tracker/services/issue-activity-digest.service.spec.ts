import { describe, it, expect, vi, beforeEach } from 'vitest';

import { IssueActivityDigestService } from './issue-activity-digest.service';

interface Activity {
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
}

function build(opts?: {
  activities?: Activity[];
  comments?: number;
  progressUpdates?: number;
  enabled?: boolean;
}) {
  const activities = opts?.activities ?? [];
  const prisma = {
    issueActivity: {
      findMany: vi.fn(async () => activities),
    },
    issueComment: {
      count: vi.fn(async () => opts?.comments ?? 0),
    },
    issueProgressUpdate: {
      count: vi.fn(async () => opts?.progressUpdates ?? 0),
    },
  };
  const issues = {
    requireIssue: vi.fn(async () => ({ id: 'i1', title: 'Задача про отчёт' })),
  };
  const cfg = {
    getDynamic: vi.fn(async <T>(_k: string, _e: string | undefined, def: T) =>
      opts?.enabled === false ? (false as unknown as T) : def,
    ),
  };
  const llm = {
    call: vi.fn(async () => ({ text: '— Статус сменился\n— Закрыт пункт' })),
  };
  const svc = new IssueActivityDigestService(
    prisma as never,
    issues as never,
    cfg as never,
    llm as never,
    undefined,
  );
  return { svc, prisma, issues, cfg, llm };
}

describe('IssueActivityDigestService', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it('пустая история → дружелюбное «изменений нет» БЕЗ вызова LLM', async () => {
    const res = await ctx.svc.getActivityDigest({
      issueId: 'i1',
      tenantId: 't1',
    });
    expect(res.hasChanges).toBe(false);
    expect(res.summary).toContain('ничего не менялось');
    expect(res.points).toHaveLength(0);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  it('история (смена статуса + закрытый чек-пункт) → агрегаты собраны и LLM вызван', async () => {
    ctx = build({
      activities: [
        {
          verb: 'status_changed',
          field: null,
          oldValue: { name: 'Бэклог' },
          newValue: { name: 'В работе' },
          createdAt: new Date('2026-06-20T10:00:00Z'),
        },
        {
          verb: 'checklist_completed',
          field: null,
          oldValue: null,
          newValue: 'Согласовать макет',
          createdAt: new Date('2026-06-21T09:00:00Z'),
        },
      ],
    });

    const res = await ctx.svc.getActivityDigest({
      issueId: 'i1',
      tenantId: 't1',
    });

    expect(res.hasChanges).toBe(true);
    expect(ctx.llm.call).toHaveBeenCalledTimes(1);
    const callArg = (ctx.llm.call.mock.calls as unknown[][])[0]?.[0] as {
      taskType?: string;
    };
    expect(callArg.taskType).toBe('issue-activity-digest');
    expect(res.points.some((p) => p.includes('статус'))).toBe(true);
    expect(res.points.some((p) => p.includes('чек-листа'))).toBe(true);
  });

  it('kill-switch OFF → 200 с пояснением, без LLM', async () => {
    ctx = build({ enabled: false });
    const res = await ctx.svc.getActivityDigest({
      issueId: 'i1',
      tenantId: 't1',
    });
    expect(res.hasChanges).toBe(false);
    expect(res.summary).toContain('выключена');
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  it('нет LLM → fallback из агрегатов без падения', async () => {
    const activities: Activity[] = [
      {
        verb: 'status_changed',
        field: null,
        oldValue: null,
        newValue: { name: 'Готово' },
        createdAt: new Date('2026-06-21T09:00:00Z'),
      },
    ];
    const prisma = {
      issueActivity: { findMany: vi.fn(async () => activities) },
      issueComment: { count: vi.fn(async () => 0) },
      issueProgressUpdate: { count: vi.fn(async () => 0) },
    };
    const issues = {
      requireIssue: vi.fn(async () => ({ id: 'i1', title: 'T' })),
    };
    const cfg = {
      getDynamic: vi.fn(
        async <T>(_k: string, _e: string | undefined, def: T) => def,
      ),
    };
    const svc = new IssueActivityDigestService(
      prisma as never,
      issues as never,
      cfg as never,
      undefined,
      undefined,
    );
    const res = await svc.getActivityDigest({ issueId: 'i1', tenantId: 't1' });
    expect(res.hasChanges).toBe(true);
    expect(res.summary.length).toBeGreaterThan(0);
  });
});
