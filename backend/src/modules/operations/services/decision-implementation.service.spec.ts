import { describe, expect, it, vi } from 'vitest';

import { DecisionImplementationService } from './decision-implementation.service';

describe('DecisionImplementationService', () => {
  const now = new Date('2026-06-08T10:00:00.000Z');

  function buildCfg() {
    return {
      getDynamic: vi.fn(async (key: string, _env: string, def: unknown) =>
        key === 'decision.stale_days' ? 21 : def,
      ),
    };
  }

  function build(opts: {
    decisions?: Array<{
      id: string;
      statement: string | null;
      text: string | null;
      status?: string;
      decidedByPersonIds: string[];
      decidedAt: Date | null;
      createdAt: Date;
      linkedTaskCount: number;
      actualOutcomes: string | null;
      implementationStatus: string | null;
      impliesAction?: boolean;
    }>;
    counts?: { total: number; done: number };
    taskLinksByDecision?: Record<string, Array<{ issue: { completedAt: Date | null } | null }>>;
  }) {
    const updates: Array<{ where: unknown; data: unknown }> = [];
    let countCall = 0;
    const prisma = {
      decision: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            (opts.decisions ?? []).map((d) => ({
              status: 'approved',
              impliesAction: true,
              ...d,
            })),
          ),
        update: vi.fn(async (arg: { where: unknown; data: unknown }) => {
          updates.push(arg);
          return { id: 'd1' };
        }),
        count: vi.fn(async (_arg?: { where?: unknown }) => {
          const v = countCall === 0 ? (opts.counts?.total ?? 0) : (opts.counts?.done ?? 0);
          countCall++;
          return v;
        }),
      },
      decisionTaskLink: {
        findMany: vi.fn(async (arg: { where: { decisionId: string } }) => {
          return opts.taskLinksByDecision?.[arg.where.decisionId] ?? [];
        }),
      },
    };
    const metrics = {
      incDecisionStalled: vi.fn(),
      incDecisionAutoImplemented: vi.fn(),
      setDecisionThroughputPercent: vi.fn(),
    };
    const svc = new DecisionImplementationService(
      prisma as never,
      buildCfg() as never,
      metrics as never,
    );
    return { svc, prisma, metrics, updates };
  }

  it('старое решение без задач/outcomes → stalled + метрика на переход', async () => {
    const { svc, metrics } = build({
      decisions: [
        {
          id: 'd1',
          statement: 'Перейти на новый CRM',
          text: null,
          decidedByPersonIds: ['p1'],
          decidedAt: new Date('2026-05-01T00:00:00Z'),
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: null,
          implementationStatus: null,
        },
      ],
      counts: { total: 1, done: 0 },
    });
    const res = await svc.computeForTenant({ tenantId: 't1', now });
    expect(res.checked).toBe(1);
    expect(res.stalled).toHaveLength(1);
    expect(res.stalled[0]!.decidedByPersonIds).toEqual(['p1']);
    expect(metrics.incDecisionStalled).toHaveBeenCalledTimes(1);
  });

  it('идемпотентность: уже stalled → НЕ инкрементит метрику снова', async () => {
    const { svc, metrics } = build({
      decisions: [
        {
          id: 'd1',
          statement: 'X',
          text: null,
          decidedByPersonIds: ['p1'],
          decidedAt: new Date('2026-05-01T00:00:00Z'),
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: null,
          implementationStatus: 'stalled',
        },
      ],
      counts: { total: 1, done: 0 },
    });
    const res = await svc.computeForTenant({ tenantId: 't1', now });
    expect(res.stalled).toHaveLength(1);
    expect(metrics.incDecisionStalled).not.toHaveBeenCalled();
  });

  it('решение с outcomes → done, не stalled', async () => {
    const { svc } = build({
      decisions: [
        {
          id: 'd1',
          statement: 'Y',
          text: null,
          decidedByPersonIds: [],
          decidedAt: new Date('2026-05-01T00:00:00Z'),
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: 'Внедрено, метрики выросли',
          implementationStatus: null,
        },
      ],
      counts: { total: 1, done: 1 },
    });
    const res = await svc.computeForTenant({ tenantId: 't1', now });
    expect(res.stalled).toHaveLength(0);
  });

  it('смесь impliesAction: в stalled[] попадают только actionable-решения', async () => {
    const { svc } = build({
      decisions: [
        {
          id: 'd-actionable',
          statement: 'Внедрить новый процесс онбординга',
          text: null,
          status: 'implemented',
          decidedByPersonIds: ['p1'],
          decidedAt: new Date('2026-05-01T00:00:00Z'),
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: null,
          implementationStatus: null,
          impliesAction: true,
        },
        {
          id: 'd-strategy',
          statement: 'Решили НЕ выходить на рынок ЕС',
          text: null,
          status: 'implemented',
          decidedByPersonIds: ['p2'],
          decidedAt: new Date('2026-05-01T00:00:00Z'),
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: null,
          implementationStatus: null,
          impliesAction: false,
        },
      ],
      counts: { total: 1, done: 0 },
    });
    const res = await svc.computeForTenant({ tenantId: 't1', now });
    expect(res.stalled.map((s) => s.id)).toEqual(['d-actionable']);
  });

  describe('auto-implement (редизайн Ф8.1)', () => {
    it('approved + actualOutcomes → авто-перевод в implemented + метрика', async () => {
      const { svc, metrics, updates } = build({
        decisions: [
          {
            id: 'd1',
            statement: 'Запустить лендинг',
            text: null,
            status: 'approved',
            decidedByPersonIds: [],
            decidedAt: new Date('2026-05-01T00:00:00Z'),
            createdAt: new Date('2026-05-01T00:00:00Z'),
            linkedTaskCount: 0,
            actualOutcomes: 'Запущено, конверсия выросла',
            implementationStatus: null,
          },
        ],
        counts: { total: 1, done: 1 },
      });
      const res = await svc.computeForTenant({ tenantId: 't1', now });
      expect(res.autoImplemented).toBe(1);
      expect(metrics.incDecisionAutoImplemented).toHaveBeenCalledTimes(1);
      const statusUpdate = updates.find(
        (u) => (u.data as { status?: string }).status === 'implemented',
      );
      expect(statusUpdate).toBeDefined();
    });

    it('approved + ВСЕ связанные задачи закрыты → implemented', async () => {
      const { svc, metrics } = build({
        decisions: [
          {
            id: 'd1',
            statement: 'Внедрить регламент онбординга',
            text: null,
            status: 'approved',
            decidedByPersonIds: [],
            decidedAt: new Date('2026-06-01T00:00:00Z'),
            createdAt: new Date('2026-06-01T00:00:00Z'),
            linkedTaskCount: 2,
            actualOutcomes: null,
            implementationStatus: 'in_progress',
          },
        ],
        taskLinksByDecision: {
          d1: [
            { issue: { completedAt: new Date('2026-06-05T00:00:00Z') } },
            { issue: { completedAt: new Date('2026-06-06T00:00:00Z') } },
          ],
        },
        counts: { total: 1, done: 0 },
      });
      const res = await svc.computeForTenant({ tenantId: 't1', now });
      expect(res.autoImplemented).toBe(1);
      expect(metrics.incDecisionAutoImplemented).toHaveBeenCalledTimes(1);
    });

    it('approved + НЕ все задачи закрыты → НЕ переводит', async () => {
      const { svc, metrics } = build({
        decisions: [
          {
            id: 'd1',
            statement: 'X',
            text: null,
            status: 'approved',
            decidedByPersonIds: [],
            decidedAt: new Date('2026-06-01T00:00:00Z'),
            createdAt: new Date('2026-06-01T00:00:00Z'),
            linkedTaskCount: 2,
            actualOutcomes: null,
            implementationStatus: 'in_progress',
          },
        ],
        taskLinksByDecision: {
          d1: [
            { issue: { completedAt: new Date('2026-06-05T00:00:00Z') } },
            { issue: { completedAt: null } },
          ],
        },
        counts: { total: 1, done: 0 },
      });
      const res = await svc.computeForTenant({ tenantId: 't1', now });
      expect(res.autoImplemented).toBe(0);
      expect(metrics.incDecisionAutoImplemented).not.toHaveBeenCalled();
    });

    it('approved без задач и без outcomes → НЕ переводит (нельзя автозакрыть «голое»)', async () => {
      const { svc } = build({
        decisions: [
          {
            id: 'd1',
            statement: 'X',
            text: null,
            status: 'approved',
            decidedByPersonIds: [],
            decidedAt: new Date('2026-06-10T00:00:00Z'),
            createdAt: new Date('2026-06-10T00:00:00Z'),
            linkedTaskCount: 0,
            actualOutcomes: null,
            implementationStatus: 'not_started',
          },
        ],
        counts: { total: 1, done: 0 },
      });
      const res = await svc.computeForTenant({ tenantId: 't1', now });
      expect(res.autoImplemented).toBe(0);
    });

    it('уже implemented (не approved) + outcomes → no-op (идемпотентность)', async () => {
      const { svc, metrics } = build({
        decisions: [
          {
            id: 'd1',
            statement: 'X',
            text: null,
            status: 'implemented',
            decidedByPersonIds: [],
            decidedAt: new Date('2026-05-01T00:00:00Z'),
            createdAt: new Date('2026-05-01T00:00:00Z'),
            linkedTaskCount: 1,
            actualOutcomes: 'Готово',
            implementationStatus: 'done',
          },
        ],
        counts: { total: 1, done: 1 },
      });
      const res = await svc.computeForTenant({ tenantId: 't1', now });
      expect(res.autoImplemented).toBe(0);
      expect(metrics.incDecisionAutoImplemented).not.toHaveBeenCalled();
    });
  });

  describe('getDecisionThroughput', () => {
    it('% = done/total × 100', async () => {
      const { svc } = build({ counts: { total: 10, done: 4 } });
      const tp = await svc.getDecisionThroughput({
        tenantId: 't1',
        from: new Date('2026-03-01'),
        to: now,
      });
      expect(tp).toEqual({
        total: 10,
        doneWithOutcomes: 4,
        throughputPercent: 40,
      });
    });

    it('total=0 → 0% без деления на ноль', async () => {
      const { svc } = build({ counts: { total: 0, done: 0 } });
      const tp = await svc.getDecisionThroughput({
        tenantId: 't1',
        from: new Date('2026-03-01'),
        to: now,
      });
      expect(tp.throughputPercent).toBe(0);
    });

    it('count вызывается с where, содержащим impliesAction: true (знаменатель только actionable)', async () => {
      const { svc, prisma } = build({ counts: { total: 5, done: 2 } });
      await svc.getDecisionThroughput({
        tenantId: 't1',
        from: new Date('2026-03-01'),
        to: now,
      });
      expect(prisma.decision.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ impliesAction: true }),
        }),
      );
    });
  });

  describe('listDecisionsForMonth (Ф3 редизайн)', () => {
    it('маппит статус→% и сортирует done→in_progress→stalled→not_started', async () => {
      const { svc } = build({
        decisions: [
          {
            id: 'd-stalled',
            statement: 'Сменить CRM',
            text: null,
            decidedByPersonIds: [],
            decidedAt: new Date('2026-04-20T00:00:00Z'),
            createdAt: new Date('2026-04-20T00:00:00Z'),
            linkedTaskCount: 0,
            actualOutcomes: null,
            implementationStatus: null,
          },
          {
            id: 'd-done',
            statement: 'Запустить лендинг',
            text: null,
            decidedByPersonIds: [],
            decidedAt: new Date('2026-05-05T00:00:00Z'),
            createdAt: new Date('2026-05-05T00:00:00Z'),
            linkedTaskCount: 2,
            actualOutcomes: 'Запущено',
            implementationStatus: 'done',
          },
          {
            id: 'd-prog',
            statement: 'Нанять маркетолога',
            text: null,
            decidedByPersonIds: [],
            decidedAt: new Date('2026-05-25T00:00:00Z'),
            createdAt: new Date('2026-05-25T00:00:00Z'),
            linkedTaskCount: 1,
            actualOutcomes: null,
            implementationStatus: 'in_progress',
          },
        ],
      });
      const rows = await svc.listDecisionsForMonth({
        tenantId: 't1',
        from: new Date('2026-05-01T00:00:00Z'),
        to: new Date('2026-05-31T23:59:59Z'),
        now,
      });
      expect(rows.map((r) => r.id)).toEqual(['d-done', 'd-prog', 'd-stalled']);
      expect(rows.find((r) => r.id === 'd-done')!.throughputPercent).toBe(100);
      expect(rows.find((r) => r.id === 'd-prog')!.throughputPercent).toBe(50);
      expect(rows.find((r) => r.id === 'd-stalled')!.status).toBe('stalled');
      expect(rows.find((r) => r.id === 'd-stalled')!.throughputPercent).toBe(0);
    });

    it('ограничивает топ-N (limit)', async () => {
      const many = Array.from({ length: 20 }, (_, i) => ({
        id: `d${i}`,
        statement: `Решение ${i}`,
        text: null,
        decidedByPersonIds: [],
        decidedAt: new Date('2026-05-10T00:00:00Z'),
        createdAt: new Date('2026-05-10T00:00:00Z'),
        linkedTaskCount: 1,
        actualOutcomes: null,
        implementationStatus: 'in_progress' as const,
      }));
      const { svc } = build({ decisions: many });
      const rows = await svc.listDecisionsForMonth({
        tenantId: 't1',
        from: new Date('2026-05-01T00:00:00Z'),
        to: new Date('2026-05-31T23:59:59Z'),
        limit: 10,
        now,
      });
      expect(rows).toHaveLength(10);
    });
  });
});
