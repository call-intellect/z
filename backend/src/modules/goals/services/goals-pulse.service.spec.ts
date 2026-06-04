import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { GoalsPulseService } from './goals-pulse.service';

/**
 * Goals OKR v2 (Фаза 4) — unit-тесты GoalsPulseService.
 *
 * Покрываем (§ТЗ Фаза 4 C):
 *   - aggregate считает счётчики по progressStatus + newThisWeek корректно;
 *   - getOrGenerate идемпотентен (повтор → getStored, без повторного llm.call);
 *   - generate при падении llm → fallback markdown (llmTaskRouteId=null),
 *     digest всё равно создан.
 */

type Fn = ReturnType<typeof vi.fn>;

interface PrismaStub {
  goal: { findMany: Fn };
  weeklyGoalsPulseDigest: {
    findUnique: Fn;
    upsert: Fn;
    updateMany: Fn;
  };
}

const WEEK_START = new Date('2026-05-25T21:00:00.000Z'); // пн 00:00 МСК
const WEEK_END = new Date('2026-06-01T21:00:00.000Z'); // след. пн 00:00 МСК

function makeGoal(over: {
  id: string;
  name?: string;
  progressStatus: string;
  createdAt?: Date;
  keyResults?: Array<{ startValue: number; targetValue: number; currentValue: number }>;
}) {
  return {
    id: over.id,
    name: over.name ?? over.id,
    progressStatus: over.progressStatus,
    createdAt: over.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    keyResults: (over.keyResults ?? []).map((kr) => ({
      startValue: kr.startValue,
      targetValue: kr.targetValue,
      currentValue: kr.currentValue,
    })),
  };
}

function makePrisma(over: Partial<PrismaStub> = {}): {
  prisma: PrismaStub;
  upsert: Fn;
  findUnique: Fn;
} {
  const upsert = vi.fn(async (args: { create: Record<string, unknown> }) => ({
    id: 'digest1',
    tenantId: 't1',
    isoWeek: (args.create.isoWeek as string) ?? '2026-W22',
    bodyMarkdown: (args.create.bodyMarkdown as string) ?? '',
    metricsJson: args.create.metricsJson ?? {},
    llmTaskRouteId: (args.create.llmTaskRouteId as string | null) ?? null,
    shortSummary: (args.create.shortSummary as string | null) ?? null,
    deliveredAt: null,
    createdAt: new Date('2026-06-01T06:00:00.000Z'),
  }));
  const findUnique = vi.fn(async () => null);
  const prisma: PrismaStub = {
    goal: { findMany: vi.fn(async () => []) },
    weeklyGoalsPulseDigest: {
      findUnique,
      upsert,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    ...over,
  };
  return { prisma, upsert, findUnique };
}

function makeMetrics(): { metrics: BusinessMetricsService } {
  const metrics = {
    incGoalsPulseGenerated: vi.fn(),
    incGoalsPulseFailed: vi.fn(),
    incGoalsPulseDelivered: vi.fn(),
  } as unknown as BusinessMetricsService;
  return { metrics };
}

function makeLlm(result: { text: string; modelUsed: string } | Error): {
  llm: LlmRouterService;
  call: Fn;
} {
  const call = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const llm = { call } as unknown as LlmRouterService;
  return { llm, call };
}

describe('GoalsPulseService', () => {
  let baseLlm: { llm: LlmRouterService; call: Fn };

  beforeEach(() => {
    baseLlm = makeLlm({
      text: 'Тело пульса.\n---SHORT_SUMMARY---\nКоротко.',
      modelUsed: 'deepseek:deepseek-v4-pro',
    });
  });

  it('aggregate: считает счётчики по progressStatus + newThisWeek', async () => {
    const goals = [
      makeGoal({ id: 'g1', progressStatus: 'on_track' }),
      makeGoal({ id: 'g2', progressStatus: 'on_track' }),
      makeGoal({ id: 'g3', progressStatus: 'at_risk' }),
      makeGoal({ id: 'g4', progressStatus: 'stalled' }),
      makeGoal({ id: 'g5', progressStatus: 'achieved' }),
      makeGoal({ id: 'g6', progressStatus: 'dropped' }),
      // создана в окне недели → newThisWeek++
      makeGoal({
        id: 'g7',
        progressStatus: 'on_track',
        createdAt: new Date('2026-05-27T10:00:00.000Z'),
      }),
    ];
    const { prisma } = makePrisma({
      goal: { findMany: vi.fn(async () => goals) },
    });
    const { metrics } = makeMetrics();
    const svc = new GoalsPulseService(
      prisma as unknown as PrismaService,
      baseLlm.llm,
      metrics,
    );

    const agg = await svc.aggregate({
      tenantId: 't1',
      isoWeek: '2026-W22',
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });

    expect(agg.counters.total).toBe(7);
    expect(agg.counters.on_track).toBe(3);
    expect(agg.counters.at_risk).toBe(1);
    expect(agg.counters.stalled).toBe(1);
    expect(agg.counters.achieved).toBe(1);
    expect(agg.counters.dropped).toBe(1);
    expect(agg.counters.newThisWeek).toBe(1);
    expect(agg.goals).toHaveLength(7);
  });

  it('aggregate: avgKrProgress — clamp 0..100, среднее по KR; null без KR', async () => {
    const goals = [
      // KR1 50%, KR2 100% (clamp) → среднее 75%
      makeGoal({
        id: 'g1',
        progressStatus: 'on_track',
        keyResults: [
          { startValue: 0, targetValue: 100, currentValue: 50 },
          { startValue: 0, targetValue: 100, currentValue: 200 },
        ],
      }),
      makeGoal({ id: 'g2', progressStatus: 'on_track' }), // нет KR
    ];
    const { prisma } = makePrisma({
      goal: { findMany: vi.fn(async () => goals) },
    });
    const { metrics } = makeMetrics();
    const svc = new GoalsPulseService(
      prisma as unknown as PrismaService,
      baseLlm.llm,
      metrics,
    );

    const agg = await svc.aggregate({
      tenantId: 't1',
      isoWeek: '2026-W22',
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });

    expect(agg.goals[0]!.avgKrProgress).toBe(75);
    expect(agg.goals[1]!.avgKrProgress).toBeNull();
  });

  it('getOrGenerate: идемпотентен — при существующем НЕ зовёт llm.call', async () => {
    const existing = {
      id: 'digest1',
      tenantId: 't1',
      isoWeek: '2026-W22',
      bodyMarkdown: 'уже есть',
      metricsJson: { total: 0 },
      llmTaskRouteId: 'prompt-v1+x',
      shortSummary: 's',
      deliveredAt: null,
      createdAt: new Date(),
    };
    const { prisma } = makePrisma({
      weeklyGoalsPulseDigest: {
        findUnique: vi.fn(async () => existing),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
    });
    const { metrics } = makeMetrics();
    const svc = new GoalsPulseService(
      prisma as unknown as PrismaService,
      baseLlm.llm,
      metrics,
    );

    const out = await svc.getOrGenerate({
      tenantId: 't1',
      isoWeek: '2026-W22',
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });

    expect(out.bodyMarkdown).toBe('уже есть');
    expect(baseLlm.call).not.toHaveBeenCalled();
    expect(prisma.weeklyGoalsPulseDigest.upsert).not.toHaveBeenCalled();
  });

  it('generate: успех LLM → парсит body + shortSummary + llmTaskRouteId', async () => {
    const { prisma, upsert } = makePrisma({
      goal: {
        findMany: vi.fn(async () => [
          makeGoal({ id: 'g1', progressStatus: 'on_track' }),
        ]),
      },
    });
    const { metrics } = makeMetrics();
    const svc = new GoalsPulseService(
      prisma as unknown as PrismaService,
      baseLlm.llm,
      metrics,
    );

    const out = await svc.generate({
      tenantId: 't1',
      isoWeek: '2026-W22',
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });

    expect(baseLlm.call).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'goals-pulse-summarize' }),
    );
    expect(out.bodyMarkdown).toBe('Тело пульса.');
    expect(out.shortSummary).toBe('Коротко.');
    expect(out.llmTaskRouteId).toContain('prompt-v1+');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(metrics.incGoalsPulseGenerated).toHaveBeenCalledWith(
      expect.objectContaining({ tenantTop: expect.any(String) }),
    );
  });

  it('generate: падение LLM → fallback markdown, llmTaskRouteId=null, digest создан', async () => {
    const { llm } = makeLlm(new Error('llm down'));
    const { prisma, upsert } = makePrisma({
      goal: {
        findMany: vi.fn(async () => [
          makeGoal({ id: 'g1', progressStatus: 'at_risk' }),
        ]),
      },
    });
    const { metrics } = makeMetrics();
    const svc = new GoalsPulseService(
      prisma as unknown as PrismaService,
      llm,
      metrics,
    );

    const out = await svc.generate({
      tenantId: 't1',
      isoWeek: '2026-W22',
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });

    // fallback пишет заголовок «# Пульс целей за неделю ...»
    expect(out.bodyMarkdown).toContain('Пульс целей за неделю');
    expect(out.llmTaskRouteId).toBeNull();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(metrics.incGoalsPulseFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'llm_failed' }),
    );
  });
});
