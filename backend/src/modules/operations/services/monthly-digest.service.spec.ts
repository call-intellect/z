import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { WeeklyPerPersonDto } from '../dto/weekly-per-person.dto';

import { MonthlyDigestService } from './monthly-digest.service';

function readJson(value: unknown): unknown {
  return value === Prisma.JsonNull || value === undefined ? null : value;
}

const VALID_MONTH_COMPANY = {
  verdict: {
    overall: { state: 'warn', emoji: '⚠️', title: 'Месяц сдвига', oneLiner: 'итог' },
    axes: [
      { key: 'team', state: 'ok', label: 'Норма', why: 'w' },
      { key: 'clients', state: 'ok', label: 'ок', why: 'w' },
      { key: 'execution', state: 'warn', label: 'Буксует', why: 'w' },
      { key: 'overall', state: 'warn', label: 'Сдвиг', why: 'w' },
    ],
  },
  letter: [{ key: 'main', title: 'Главное', prose: 'проза' }],
  goalAlignmentMonth: {
    direction: 'drift',
    score: 41,
    monthDelta: '+2 из 10',
    leadingSignal: 'найм закрывает дыру',
    why: 'w',
    pro: [],
    contra: [],
  },
  ownerForks: [{ title: 'Нанять PM', why: 'тащит один' }],
  nextFocus: [{ title: 'Закрыть онбординг', why: 'долг недель' }],
  risksSummary: 'r',
  ideasSummary: 'i',
};

function weeklyRow(weekStart: string, overallState: 'ok' | 'warn' | 'risk') {
  return {
    id: `wd-${weekStart}`,
    weekStart,
    verdictJson: {
      overall: { state: overallState, title: `Неделя ${weekStart}`, oneLiner: 'итог недели' },
      axes: [
        { key: 'team', state: 'ok' },
        { key: 'clients', state: overallState },
        { key: 'execution', state: 'ok' },
        { key: 'overall', state: overallState },
      ],
    },
    metricsJson: {
      greenShare: 0.5,
      redShare: 0.2,
      totalCheckIns: 10,
      goals: { completed: 2, failed: 1 },
      topBlockers: [{ text: 'нет доступа к S3', count: 2 }],
    },
  };
}

describe('MonthlyDigestService', () => {
  function buildSvc(overrides: {
    weekRows?: Array<unknown | null>;
    existing?: unknown;
    latest?: unknown;
    ppResult?: WeeklyPerPersonDto;
    llmResult?: { text: string; modelUsed: string };
    llmReject?: Error;
    goal?: unknown;
    snapshot?: unknown;
  }) {
    let weekCallIndex = 0;
    const weekRows = overrides.weekRows ?? [
      weeklyRow('2026-05-04', 'ok'),
      weeklyRow('2026-05-11', 'warn'),
      weeklyRow('2026-05-18', 'ok'),
      weeklyRow('2026-05-25', 'warn'),
    ];
    const weeklyFindUnique = vi.fn().mockImplementation(() => {
      const row = weekRows[weekCallIndex++] ?? null;
      return Promise.resolve(row);
    });
    const monthlyFindUnique = vi.fn().mockResolvedValue(overrides.existing ?? null);
    const monthlyFindFirst = vi.fn().mockResolvedValue(overrides.latest ?? null);
    const monthlyFindMany = vi.fn().mockResolvedValue([]);
    const monthlyUpsert = vi
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
            id: 'md1',
            tenantId: 't1',
            periodYm: '2026-05',
            bodyMarkdown: (row.bodyMarkdown as string) ?? '',
            metricsJson: row.metricsJson,
            sourcesJson: row.sourcesJson,
            llmTaskRouteId: row.llmTaskRouteId ?? null,
            shortSummary: (row.shortSummary as string | null) ?? null,
            deliveredAt: null,
            verdictJson: readJson(row.verdictJson),
            letterJson: readJson(row.letterJson),
            goalAlignmentMonthJson: readJson(row.goalAlignmentMonthJson),
            weekTrendJson: readJson(row.weekTrendJson),
            createdAt: new Date('2026-06-01T06:00:00Z'),
          });
        },
      );
    const prisma = {
      weeklyOperationsDigest: {
        findUnique: weeklyFindUnique,
      },
      monthlyOperationsDigest: {
        findUnique: monthlyFindUnique,
        findFirst: monthlyFindFirst,
        findMany: monthlyFindMany,
        upsert: monthlyUpsert,
      },
      goal: {
        findFirst: vi.fn().mockResolvedValue(overrides.goal ?? null),
      },
      goalAlignmentSnapshot: {
        findFirst: vi.fn().mockResolvedValue(overrides.snapshot ?? null),
      },
      insight: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      ideaCluster: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const llm = {
      call: overrides.llmReject
        ? vi.fn().mockRejectedValue(overrides.llmReject)
        : vi.fn().mockResolvedValue(
            overrides.llmResult ?? {
              text: JSON.stringify(VALID_MONTH_COMPANY),
              modelUsed: 'deepseek:deepseek-v4-pro',
            },
          ),
    };
    const metrics = {
      incCooMonthlyDigestGenerated: vi.fn(),
      incCooMonthlyDigestFailed: vi.fn(),
    };
    const perPerson = {
      compute: vi.fn().mockResolvedValue(
        overrides.ppResult ?? {
          weekStart: '2026-05-01',
          weekEnd: '2026-05-31',
          generatedAt: '',
          total: 0,
          topRisk: [],
          rows: [],
        },
      ),
    };
    const getBlockers = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const getTeamFrictions = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const opsDashboard = { getTeamFrictions, getBlockers };
    const svc = new MonthlyDigestService(
      prisma as never,
      llm as never,
      metrics as never,
      perPerson as never,
      opsDashboard as never,
    );
    return { svc, prisma, llm, metrics, perPerson, weeklyFindUnique, opsDashboard };
  }

  it('generate: при успехе LLM сохраняет вердикт/письмо/компас/weekTrend', async () => {
    const { svc, prisma, metrics } = buildSvc({});
    const result = await svc.generate({ tenantId: 't1', periodYm: '2026-05' });
    expect(result.verdict).not.toBeNull();
    expect(result.letter).not.toBeNull();
    expect(result.goalAlignmentMonth).not.toBeNull();
    expect(Array.isArray(result.weekTrend)).toBe(true);
    expect(result.weekTrend).toHaveLength(4);
    expect(result.llmTaskRouteId).toContain('month-company-v2');
    expect(prisma.monthlyOperationsDigest.upsert).toHaveBeenCalledOnce();
    expect(prisma.monthlyOperationsDigest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          verdictJson: expect.anything(),
          letterJson: expect.anything(),
          goalAlignmentMonthJson: expect.anything(),
        }),
      }),
    );
    expect(metrics.incCooMonthlyDigestGenerated).toHaveBeenCalledOnce();
  });

  it('generate: verdictJson/letterJson/goalAlignmentMonthJson НЕ null при успехе', async () => {
    const { svc, prisma } = buildSvc({});
    await svc.generate({ tenantId: 't1', periodYm: '2026-05' });
    const call = prisma.monthlyOperationsDigest.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.verdictJson).not.toBe(Prisma.JsonNull);
    expect(call.create.letterJson).not.toBe(Prisma.JsonNull);
    expect(call.create.goalAlignmentMonthJson).not.toBe(Prisma.JsonNull);
    expect(call.create.weekTrendJson).not.toBe(Prisma.JsonNull);
  });

  it('generate: при провале LLM — fallback, verdict/letter/goalAlignmentMonth null, weekTrend массив', async () => {
    const { svc, prisma, metrics } = buildSvc({ llmReject: new Error('LLM down') });
    const result = await svc.generate({ tenantId: 't1', periodYm: '2026-05' });
    expect(result.verdict).toBeNull();
    expect(result.letter).toBeNull();
    expect(result.goalAlignmentMonth).toBeNull();
    expect(Array.isArray(result.weekTrend)).toBe(true);
    expect(result.weekTrend).toHaveLength(4);
    expect(result.llmTaskRouteId).toBeNull();
    const call = prisma.monthlyOperationsDigest.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.verdictJson).toBe(Prisma.JsonNull);
    expect(call.create.letterJson).toBe(Prisma.JsonNull);
    expect(call.create.goalAlignmentMonthJson).toBe(Prisma.JsonNull);
    expect(call.create.weekTrendJson).not.toBe(Prisma.JsonNull);
    expect(metrics.incCooMonthlyDigestFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'llm_failed' }),
    );
  });

  it('buildMonthPackage: findUnique вызывается с select БЕЗ letterJson', async () => {
    const { svc, weeklyFindUnique } = buildSvc({});
    await svc.generate({ tenantId: 't1', periodYm: '2026-05' });
    expect(weeklyFindUnique).toHaveBeenCalled();
    const firstArg = weeklyFindUnique.mock.calls[0]![0] as { select: Record<string, unknown> };
    expect(firstArg.select).toEqual(
      expect.objectContaining({ verdictJson: true, metricsJson: true, id: true }),
    );
    expect(firstArg.select).not.toHaveProperty('letterJson');
  });

  it('buildMonthPackage: отсутствующая неделя → попадает в missingWeeks', async () => {
    const { svc } = buildSvc({
      weekRows: [weeklyRow('2026-05-04', 'ok'), null, weeklyRow('2026-05-18', 'ok'), null],
    });
    const result = await svc.generate({ tenantId: 't1', periodYm: '2026-05' });
    expect(result.metrics.missingWeeks).toContain('2026-05-11');
    expect(result.metrics.missingWeeks).toContain('2026-05-25');
    expect(result.metrics.weeksCount).toBe(2);
  });

  it('getOrGenerate: если запись уже есть — не вызывает LLM', async () => {
    const { svc, llm } = buildSvc({
      existing: {
        id: 'md1',
        tenantId: 't1',
        periodYm: '2026-05',
        bodyMarkdown: 'старый текст',
        metricsJson: {},
        sourcesJson: {},
        llmTaskRouteId: 'deepseek:deepseek-v4-pro',
        shortSummary: null,
        deliveredAt: null,
        verdictJson: null,
        letterJson: null,
        goalAlignmentMonthJson: null,
        weekTrendJson: null,
        createdAt: new Date('2026-06-01T06:00:00Z'),
      },
    });
    const result = await svc.getOrGenerate({ tenantId: 't1', periodYm: '2026-05' });
    expect(result.bodyMarkdown).toBe('старый текст');
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('getLatest: возвращает последний месяц orderBy periodYm desc', async () => {
    const { svc, prisma } = buildSvc({
      latest: {
        id: 'md9',
        tenantId: 't1',
        periodYm: '2026-06',
        bodyMarkdown: 'последний',
        metricsJson: {},
        sourcesJson: {},
        llmTaskRouteId: 'month-company-v1+deepseek:deepseek-v4-pro',
        shortSummary: null,
        deliveredAt: null,
        verdictJson: null,
        createdAt: new Date('2026-07-01T06:00:00Z'),
      },
    });
    const result = await svc.getLatest({ tenantId: 't1' });
    expect(result?.periodYm).toBe('2026-06');
    expect(prisma.monthlyOperationsDigest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { periodYm: 'desc' } }),
    );
  });

  it('generate: metricsJson содержит плитки окна risksByCause/ideaClusters/teamFrictions/blockers массивами', async () => {
    const { svc, prisma, opsDashboard } = buildSvc({});
    await svc.generate({ tenantId: 't1', periodYm: '2026-05' });
    const call = prisma.monthlyOperationsDigest.upsert.mock.calls[0]![0] as {
      create: { metricsJson: Record<string, unknown> };
    };
    const m = call.create.metricsJson;
    expect(Array.isArray(m.risksByCause)).toBe(true);
    expect(Array.isArray(m.ideaClusters)).toBe(true);
    expect(Array.isArray(m.teamFrictions)).toBe(true);
    expect(Array.isArray(m.blockers)).toBe(true);
    expect(opsDashboard.getBlockers).toHaveBeenCalledWith(
      expect.objectContaining({ window: { from: '2026-05-01', to: '2026-05-31' } }),
    );
  });

  it('listAvailablePeriods: rhythm=month, periodYm DESC, stateHint/title, legacy→null, latest', async () => {
    const { svc, prisma } = buildSvc({});
    prisma.monthlyOperationsDigest.findMany.mockResolvedValueOnce([
      { periodYm: '2026-06', verdictJson: { overall: { state: 'ok', title: 'Сильный месяц' } } },
      { periodYm: '2026-05', verdictJson: { overall: { state: 'warn', title: 'Месяц сдвига' } } },
      { periodYm: '2026-04', verdictJson: null },
    ]);
    const result = await svc.listAvailablePeriods({ tenantId: 't1', limit: 12 });
    expect(result.rhythm).toBe('month');
    expect(result.periods.map((p) => p.period)).toEqual(['2026-06', '2026-05', '2026-04']);
    expect(result.periods[0]).toEqual({
      period: '2026-06',
      stateHint: 'ok',
      title: 'Сильный месяц',
    });
    expect(result.periods[2]).toEqual({ period: '2026-04', stateHint: null, title: null });
    expect(result.latest).toBe('2026-06');
    expect(prisma.monthlyOperationsDigest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { periodYm: 'desc' }, take: 12 }),
    );
  });
});
