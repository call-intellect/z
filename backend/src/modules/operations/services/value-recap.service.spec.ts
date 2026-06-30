import { describe, expect, it, vi } from 'vitest';

import { findForbiddenMetricKeys } from './value-recap.scoring';
import { monthBounds, shiftPeriod, ValueRecapService } from './value-recap.service';

describe('ValueRecapService', () => {
  const now = new Date('2026-06-01T07:00:00.000Z');

  function buildService(opts: {
    prevSnapshotRoutine?: Record<string, number> | null;
    existingDelivered?: boolean;
    llmText?: string | null;
    llmThrows?: boolean;
  }) {
    const upsert = vi.fn(async () => ({ id: 'recap1' }));
    const findUnique = vi.fn(
      async (arg: {
        where: { tenantId_periodYm: { periodYm: string } };
        select?: Record<string, boolean>;
      }) => {
        const period = arg.where.tenantId_periodYm.periodYm;
        if (period === shiftPeriod('2026-05', -1)) {
          if (opts.prevSnapshotRoutine == null) return null;
          return {
            payloadJson: { routine: opts.prevSnapshotRoutine },
          };
        }
        return { id: 'recap1', deliveredAt: opts.existingDelivered ? new Date() : null };
      },
    );

    const prisma = {
      aiResult: { count: vi.fn(async () => 12) },
      issue: { count: vi.fn(async () => 40) },
      decision: { count: vi.fn(async () => 8) },
      ideaBlock: {
        count: vi.fn(async () => 15),
        findMany: vi.fn(async () => [
          { commitmentStatus: 'fulfilled', commitmentDueDate: new Date('2026-05-10') },
          { commitmentStatus: 'fulfilled', commitmentDueDate: new Date('2026-05-11') },
          { commitmentStatus: 'missed', commitmentDueDate: new Date('2026-05-12') },
          { commitmentStatus: 'fulfilled', commitmentDueDate: new Date('2026-05-13') },
        ]),
      },
      dailyCheckIn: { count: vi.fn(async () => 60) },
      idea: { count: vi.fn(async () => 3) },
      valueRecapSnapshot: { findUnique, upsert },
    };

    const cfg = {
      getDynamic: vi.fn(async (_k: string, _e: string, def: unknown) => def),
    };
    const metrics = { incValueRecapBuilt: vi.fn() };
    const llm = {
      call: vi.fn(async () => {
        if (opts.llmThrows) throw new Error('llm down');
        return { text: opts.llmText ?? 'Честная сводка за месяц.' };
      }),
    };
    const chatFeedback = {
      getChatUsageStats: vi.fn(async () => ({
        asked: 30,
        answered: 28,
        answeredWithCitation: 22,
        rated: 12,
        helpedUp: 9,
        helpedRatePercent: 75,
        feedbackCoveragePercent: 43,
        groundedRatePercent: 79,
        helpedRateHidden: false,
        minRated: 10,
      })),
    };
    const svc = new ValueRecapService(
      prisma as never,
      cfg as never,
      metrics as never,
      llm as never,
      chatFeedback as never,
    );
    return { svc, prisma, metrics, llm, upsert, chatFeedback };
  }

  it('build собирает payload на твёрдых счётчиках; НЕТ запрещённых метрик (Р6)', async () => {
    const { svc, metrics, upsert } = buildService({ prevSnapshotRoutine: null });
    const res = await svc.build({ tenantId: 't1', periodYm: '2026-05', now });

    expect(res.payload.routine.meetingsAutoProtocoled).toBe(12);
    expect(res.payload.routine.tasksExtracted).toBe(40);
    expect(res.payload.routine.questionsAnsweredWithCitation).toBe(22);
    expect(res.payload.team.reliabilityPercent).toBe(75);
    expect(res.payload.team.reliabilityDenominator).toBe(4);
    expect(res.payload.routine.decisionsExtracted).toBe(8);
    expect(findForbiddenMetricKeys(res.payload)).toEqual([]);
    expect(metrics.incValueRecapBuilt).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('baseline (нет прошлого снимка) → isBaseline=true, delta=null', async () => {
    const { svc } = buildService({ prevSnapshotRoutine: null });
    const res = await svc.build({ tenantId: 't1', periodYm: '2026-05', now });
    expect(res.payload.isBaseline).toBe(true);
    expect(res.payload.delta).toBeNull();
  });

  it('есть прошлый снимок → дельта считается', async () => {
    const { svc } = buildService({
      prevSnapshotRoutine: {
        meetingsAutoProtocoled: 8,
        tasksExtracted: 30,
        decisionsExtracted: 5,
        commitmentsExtracted: 10,
        statusesCollected: 50,
        questionsAnsweredWithCitation: 15,
        ideasShipped: 1,
      },
    });
    const res = await svc.build({ tenantId: 't1', periodYm: '2026-05', now });
    expect(res.payload.isBaseline).toBe(false);
    expect(res.payload.delta?.meetingsAutoProtocoled).toBe(4);
    expect(res.payload.delta?.tasksExtracted).toBe(10);
  });

  it('LLM упал → детерминированный fallback narrative (build не падает)', async () => {
    const { svc } = buildService({ prevSnapshotRoutine: null, llmThrows: true });
    const res = await svc.build({ tenantId: 't1', periodYm: '2026-05', now });
    expect(res.payload.narrative.length).toBeGreaterThan(0);
    expect(res.payload.narrative).toContain('2026-05');
    expect(findForbiddenMetricKeys(res.payload)).toEqual([]);
  });

  it('alreadyDelivered отражает deliveredAt существующего снимка', async () => {
    const { svc } = buildService({ prevSnapshotRoutine: null, existingDelivered: true });
    const res = await svc.build({ tenantId: 't1', periodYm: '2026-05', now });
    expect(res.alreadyDelivered).toBe(true);
  });

  describe('getLatestPeriodWithData', () => {
    function svcWithFindFirst(latest: { periodYm: string } | null) {
      const prisma = {
        valueRecapSnapshot: { findFirst: vi.fn(async () => latest) },
      };
      const svc = new ValueRecapService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { svc, prisma };
    }

    it('есть снимки → возвращает последний period', async () => {
      const { svc, prisma } = svcWithFindFirst({ periodYm: '2026-04' });
      await expect(svc.getLatestPeriodWithData('t1')).resolves.toBe('2026-04');
      expect(prisma.valueRecapSnapshot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { periodYm: 'desc' } }),
      );
    });

    it('снимков нет → null', async () => {
      const { svc } = svcWithFindFirst(null);
      await expect(svc.getLatestPeriodWithData('t1')).resolves.toBeNull();
    });
  });

  describe('helpers', () => {
    it('monthBounds — корректные границы месяца UTC', () => {
      const { from, to } = monthBounds('2026-02');
      expect(from.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(to.toISOString()).toBe('2026-02-28T23:59:59.999Z');
    });
    it('shiftPeriod — переход через год', () => {
      expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
      expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    });
  });
});
