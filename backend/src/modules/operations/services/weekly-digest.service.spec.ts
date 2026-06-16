import { describe, expect, it, vi } from 'vitest';

import { WeeklyDigestService } from './weekly-digest.service';

describe('WeeklyDigestService', () => {
  function buildSvc(overrides: {
    checkIns?: unknown[];
    blockerCheckIns?: unknown[];
    insights?: unknown[];
    goals?: unknown[];
    goalsPrev?: unknown[];
    decisions?: unknown[];
    ideas?: unknown[];
    existing?: unknown;
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
      },
      decision: {
        findMany: vi.fn().mockResolvedValue(overrides.decisions ?? []),
      },
      idea: {
        findMany: vi.fn().mockResolvedValue(overrides.ideas ?? []),
      },
      weeklyOperationsDigest: {
        findUnique: vi.fn().mockResolvedValue(overrides.existing ?? null),
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
              text: '# Тестовая сводка\n\nВсё хорошо.',
              modelUsed: 'deepseek:deepseek-chat',
            },
          ),
    };
    const metrics = {
      incCooWeeklyDigestGenerated: vi.fn(),
      incCooWeeklyDigestFailed: vi.fn(),
    };
    const svc = new WeeklyDigestService(prisma as never, llm as never, metrics as never);
    return { svc, prisma, llm, metrics };
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

  it('generate: при успехе LLM сохраняет bodyMarkdown + llmTaskRouteId', async () => {
    const { svc, prisma, metrics } = buildSvc({
      checkIns: [{ sentiment: 'green', id: 'c1' }],
      llmResult: {
        text: '## Сводка\nВсё ок.',
        modelUsed: 'deepseek:deepseek-chat',
      },
    });
    const result = await svc.generate({
      tenantId: 't1',
      weekStart: '2026-05-18',
      weekEnd: '2026-05-24',
    });
    expect(result.bodyMarkdown).toContain('Сводка');
    expect(result.llmTaskRouteId).toContain('deepseek:deepseek-chat');
    expect(prisma.weeklyOperationsDigest.upsert).toHaveBeenCalledOnce();
    expect(metrics.incCooWeeklyDigestGenerated).toHaveBeenCalledOnce();
  });

  it('generate: при провале LLM сохраняет fallback (llmTaskRouteId=null)', async () => {
    const { svc, metrics } = buildSvc({
      checkIns: [{ sentiment: 'red', id: 'c1' }],
      llmReject: new Error('LLM down'),
    });
    const result = await svc.generate({
      tenantId: 't1',
      weekStart: '2026-05-18',
      weekEnd: '2026-05-24',
    });
    expect(result.bodyMarkdown).toContain('Недельная сводка');
    expect(result.llmTaskRouteId).toBeNull();
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
});
