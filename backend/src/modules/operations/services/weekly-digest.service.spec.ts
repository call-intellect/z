import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { WeeklyPerPersonDto } from '../dto/weekly-per-person.dto';

import { WeeklyDigestService } from './weekly-digest.service';

function readJson(value: unknown): unknown {
  return value === Prisma.JsonNull || value === undefined ? null : value;
}

const VALID_WEEK_COMPANY = {
  verdict: {
    overall: { state: 'warn', emoji: '⚠️', title: 'Неделя сдвига', oneLiner: 'итог' },
    axes: [
      { key: 'team', state: 'ok', label: 'Норма', why: 'w' },
      { key: 'clients', state: 'ok', label: 'ок', why: 'w' },
      { key: 'execution', state: 'warn', label: 'Буксует', why: 'w' },
      { key: 'overall', state: 'warn', label: 'Сдвиг', why: 'w' },
    ],
  },
  letter: [{ key: 'main', title: 'Главное', prose: 'проза' }],
  goalAlignmentWeek: {
    direction: 'drift',
    score: 41,
    weekDelta: '+2 из 10',
    why: 'w',
    pro: [],
    contra: [],
  },
  risksSummary: 'r',
  ideasSummary: 'i',
};

describe('WeeklyDigestService', () => {
  function buildSvc(overrides: {
    checkIns?: unknown[];
    blockerCheckIns?: unknown[];
    insights?: unknown[];
    goals?: unknown[];
    goalsPrev?: unknown[];
    ideas?: unknown[];
    existing?: unknown;
    latest?: unknown;
    dailyDigest?: unknown;
    ppResult?: WeeklyPerPersonDto;
    llmResult?: { text: string; modelUsed: string };
    llmReject?: Error;
  }) {
    let checkInCallIndex = 0;
    let goalCallIndex = 0;
    const prisma = {
      dailyCheckIn: {
        findMany: vi.fn().mockImplementation(() => {
          const i = checkInCallIndex++;
          if (i === 0) return Promise.resolve(overrides.checkIns ?? []);
          return Promise.resolve(overrides.blockerCheckIns ?? []);
        }),
      },
      insight: {
        findMany: vi.fn().mockResolvedValue(overrides.insights ?? []),
      },
      goal: {
        findMany: vi.fn().mockImplementation(() => {
          const i = goalCallIndex++;
          if (i === 0) return Promise.resolve(overrides.goals ?? []);
          return Promise.resolve(overrides.goalsPrev ?? []);
        }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      goalAlignmentSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      idea: {
        findMany: vi.fn().mockResolvedValue(overrides.ideas ?? []),
      },
      dailyOperationsDigest: {
        findUnique: vi.fn().mockResolvedValue(overrides.dailyDigest ?? null),
      },
      weeklyOperationsDigest: {
        findUnique: vi.fn().mockResolvedValue(overrides.existing ?? null),
        findFirst: vi.fn().mockResolvedValue(overrides.latest ?? null),
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi
          .fn()
          .mockImplementation(
            ({
              create,
              update,
            }: {
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            }) => {
              const row = overrides.existing ? { ...update } : { ...create };
              return Promise.resolve({
                id: 'wd1',
                tenantId: 't1',
                weekStart: '2026-05-18',
                weekEnd: '2026-05-24',
                bodyMarkdown: (row.bodyMarkdown as string) ?? '',
                metricsJson: row.metricsJson,
                sourcesJson: row.sourcesJson,
                llmTaskRouteId: row.llmTaskRouteId ?? null,
                verdictJson: readJson(row.verdictJson),
                letterJson: readJson(row.letterJson),
                goalAlignmentWeekJson: readJson(row.goalAlignmentWeekJson),
                dayTrendJson: readJson(row.dayTrendJson),
                createdAt: new Date('2026-05-25T08:00:00Z'),
              });
            },
          ),
      },
    };
    const llm = {
      call: overrides.llmReject
        ? vi.fn().mockRejectedValue(overrides.llmReject)
        : vi.fn().mockResolvedValue(
            overrides.llmResult ?? {
              text: JSON.stringify(VALID_WEEK_COMPANY),
              modelUsed: 'deepseek:deepseek-v4-pro',
            },
          ),
    };
    const metrics = {
      incCooWeeklyDigestGenerated: vi.fn(),
      incCooWeeklyDigestFailed: vi.fn(),
    };
    const perPerson = {
      compute: vi.fn().mockResolvedValue(
        overrides.ppResult ?? {
          weekStart: '2026-05-18',
          weekEnd: '2026-05-24',
          generatedAt: '',
          total: 0,
          topReliable: [],
          topRisk: [],
          rows: [],
        },
      ),
    };
    const svc = new WeeklyDigestService(
      prisma as never,
      llm as never,
      metrics as never,
      perPerson as never,
    );
    return { svc, prisma, llm, metrics, perPerson };
  }

  it('aggregate: считает доли green/yellow/red и топ блокеров', async () => {
    const { svc } = buildSvc({
      checkIns: [
        { sentiment: 'green', id: 'c1' },
        { sentiment: 'green', id: 'c2' },
        { sentiment: 'yellow', id: 'c3' },
        { sentiment: 'red', id: 'c4' },
      ],
      blockerCheckIns: [
        {
          id: 'c1',
          blockersJson: [{ text: 'нет доступа к S3' }, { text: 'жду ответ' }],
        },
        {
          id: 'c2',
          blockersJson: [{ text: 'нет доступа к s3' }],
        },
      ],
    });
    const result = await svc.aggregate({
      tenantId: 't1',
      weekStart: '2026-05-18',
      weekEnd: '2026-05-24',
    });
    expect(result.metrics.totalCheckIns).toBe(4);
    expect(result.metrics.greenShare).toBeCloseTo(0.5);
    expect(result.metrics.yellowShare).toBeCloseTo(0.25);
    expect(result.metrics.redShare).toBeCloseTo(0.25);
    const blocker = result.metrics.topBlockers.find((b) =>
      b.text.toLowerCase().includes('нет доступа'),
    );
    expect(blocker).toBeDefined();
    expect(blocker!.count).toBe(2);
  });

  it('generate: при успехе LLM сохраняет вердикт/письмо/dayTrend', async () => {
    const { svc, prisma, metrics } = buildSvc({
      checkIns: [{ sentiment: 'green', id: 'c1' }],
    });
    const result = await svc.generate({
      tenantId: 't1',
      weekStart: '2026-05-18',
      weekEnd: '2026-05-24',
    });
    expect(result.verdict).not.toBeNull();
    expect(result.verdict?.overall.title).toContain('Неделя');
    expect(Array.isArray(result.dayTrend)).toBe(true);
    expect(result.dayTrend).toHaveLength(4);
    expect(result.llmTaskRouteId).toContain('week-company-v1');
    expect(result.bodyMarkdown).toMatch(/Главное|Неделя сдвига/);
    expect(prisma.weeklyOperationsDigest.upsert).toHaveBeenCalledOnce();
    expect(metrics.incCooWeeklyDigestGenerated).toHaveBeenCalledOnce();
  });

  it('generate: при провале LLM — fallback, verdict/letter/goalAlignmentWeek=null, dayTrend массив', async () => {
    const { svc, metrics } = buildSvc({
      checkIns: [{ sentiment: 'red', id: 'c1' }],
      llmReject: new Error('LLM down'),
    });
    const result = await svc.generate({
      tenantId: 't1',
      weekStart: '2026-05-18',
      weekEnd: '2026-05-24',
    });
    expect(result.verdict).toBeNull();
    expect(result.letter).toBeNull();
    expect(result.goalAlignmentWeek).toBeNull();
    expect(Array.isArray(result.dayTrend)).toBe(true);
    expect(result.dayTrend).toHaveLength(4);
    expect(result.llmTaskRouteId).toBeNull();
    expect(result.bodyMarkdown).toContain('Недельная сводка');
    expect(metrics.incCooWeeklyDigestFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'llm_failed' }),
    );
    expect(metrics.incCooWeeklyDigestGenerated).toHaveBeenCalledOnce();
  });

  it('getOrGenerate: если запись уже есть — не вызывает LLM', async () => {
    const { svc, llm } = buildSvc({
      existing: {
        id: 'wd1',
        tenantId: 't1',
        weekStart: '2026-05-18',
        weekEnd: '2026-05-24',
        bodyMarkdown: 'старый текст',
        metricsJson: {},
        sourcesJson: {},
        llmTaskRouteId: 'deepseek:deepseek-chat',
        verdictJson: null,
        letterJson: null,
        goalAlignmentWeekJson: null,
        dayTrendJson: null,
        createdAt: new Date('2026-05-19T08:00:00Z'),
      },
    });
    const result = await svc.getOrGenerate({
      tenantId: 't1',
      weekStart: '2026-05-18',
      weekEnd: '2026-05-24',
    });
    expect(result.bodyMarkdown).toBe('старый текст');
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('getLatest: возвращает последний дайджест', async () => {
    const { svc, prisma } = buildSvc({
      latest: {
        id: 'wd9',
        tenantId: 't1',
        weekStart: '2026-06-22',
        weekEnd: '2026-06-26',
        bodyMarkdown: 'последний',
        metricsJson: {},
        sourcesJson: {},
        llmTaskRouteId: 'week-company-v1+deepseek:deepseek-v4-pro',
        verdictJson: null,
        createdAt: new Date('2026-06-27T08:00:00Z'),
      },
    });
    const result = await svc.getLatest({ tenantId: 't1' });
    expect(result?.weekStart).toBe('2026-06-22');
    expect(prisma.weeklyOperationsDigest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { weekStart: 'desc' } }),
    );
  });

  it('getLatest: null если дайджестов нет', async () => {
    const { svc, llm } = buildSvc({});
    const result = await svc.getLatest({ tenantId: 't1' });
    expect(result).toBeNull();
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('listAvailablePeriods: rhythm=week, weekStart DESC, stateHint/title, legacy→null, latest', async () => {
    const { svc, prisma } = buildSvc({});
    prisma.weeklyOperationsDigest.findMany.mockResolvedValueOnce([
      { weekStart: '2026-06-22', verdictJson: { overall: { state: 'risk', title: 'Тяжёлая неделя' } } },
      { weekStart: '2026-06-15', verdictJson: { overall: { state: 'ok', title: 'Ровно' } } },
      { weekStart: '2026-06-08', verdictJson: null },
    ]);
    const result = await svc.listAvailablePeriods({ tenantId: 't1', limit: 12 });
    expect(result.rhythm).toBe('week');
    expect(result.periods.map((p) => p.period)).toEqual([
      '2026-06-22',
      '2026-06-15',
      '2026-06-08',
    ]);
    expect(result.periods[0]).toEqual({
      period: '2026-06-22',
      stateHint: 'risk',
      title: 'Тяжёлая неделя',
    });
    expect(result.periods[2]).toEqual({ period: '2026-06-08', stateHint: null, title: null });
    expect(result.latest).toBe('2026-06-22');
    expect(prisma.weeklyOperationsDigest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { weekStart: 'desc' }, take: 12 }),
    );
  });
});
