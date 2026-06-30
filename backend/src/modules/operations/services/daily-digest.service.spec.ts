import { describe, expect, it, vi } from 'vitest';

import { DailyDigestService } from './daily-digest.service';

describe('DailyDigestService', () => {
  function buildSvc(overrides: {
    checkIns?: unknown[];
    redCheckIns?: unknown[];
    newBlockers?: unknown[];
    overdueCommitments?: unknown[];
    goals?: unknown[];
    highInsights?: unknown[];
    existing?: unknown;
    latest?: unknown;
    llmResult?: { text: string; modelUsed: string };
    llmReject?: Error;
  }) {
    let checkInCallIndex = 0;
    let blockCallIndex = 0;
    const prisma = {
      dailyCheckIn: {
        findMany: vi.fn().mockImplementation(() => {
          const i = checkInCallIndex++;
          if (i === 0) return Promise.resolve(overrides.checkIns ?? []);
          return Promise.resolve(overrides.redCheckIns ?? []);
        }),
      },
      ideaBlock: {
        findMany: vi.fn().mockImplementation(() => {
          const i = blockCallIndex++;
          if (i === 0) return Promise.resolve(overrides.newBlockers ?? []);
          return Promise.resolve(overrides.overdueCommitments ?? []);
        }),
      },
      goal: {
        findMany: vi.fn().mockResolvedValue(overrides.goals ?? []),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      goalAlignmentSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      idea: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      insight: {
        findMany: vi.fn().mockResolvedValue(overrides.highInsights ?? []),
      },
      meeting: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      person: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      dailyOperationsDigest: {
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
              const unwrapJson = (v: unknown) =>
                v === null || v === undefined || String(v) === 'Prisma.JsonNull'
                  ? null
                  : v;
              return Promise.resolve({
                id: 'dd1',
                tenantId: 't1',
                dateLocal: '2026-05-24',
                bodyMarkdown: (row.bodyMarkdown as string) ?? '',
                metricsJson: row.metricsJson,
                sourcesJson: row.sourcesJson,
                llmTaskRouteId: row.llmTaskRouteId ?? null,
                shortSummary: (row.shortSummary as string | null) ?? null,
                deliveredAt: null,
                createdAt: new Date('2026-05-25T01:00:00Z'),
                verdictJson: unwrapJson(row.verdictJson),
                letterJson: unwrapJson(row.letterJson),
                goalAlignmentDayJson: unwrapJson(row.goalAlignmentDayJson),
              });
            },
          ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const llm = {
      call: overrides.llmReject
        ? vi.fn().mockRejectedValue(overrides.llmReject)
        : vi.fn().mockResolvedValue(
            overrides.llmResult ?? {
              text: '# Сводка\n\nВсё хорошо.\n\n---SHORT_SUMMARY---\nВчера 5 чек-инов, всё в норме.',
              modelUsed: 'deepseek:deepseek-chat',
            },
          ),
    };
    const metrics = {
      incCooDailyDigestGenerated: vi.fn(),
      incCooDailyDigestFailed: vi.fn(),
      incCooDailyDigestDelivered: vi.fn(),
      setCooDailyDigestAge: vi.fn(),
    };
    const pendingActions = {
      getCount: vi.fn().mockResolvedValue({
        total: 0,
        bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 },
      }),
      getList: vi.fn().mockResolvedValue({ items: [] }),
    };
    const customerRisk = {
      topForDigest: vi.fn().mockResolvedValue([]),
    };
    const blockerSynthesis = {
      listChronicForTenant: vi.fn().mockResolvedValue([]),
    };
    const cfg = {
      getDynamic: vi.fn().mockResolvedValue(5),
    };
    const svc = new DailyDigestService(
      prisma as never,
      llm as never,
      metrics as never,
      pendingActions as never,
      customerRisk as never,
      blockerSynthesis as never,
      cfg as never,
    );
    return {
      svc,
      prisma,
      llm,
      metrics,
      pendingActions,
      customerRisk,
      blockerSynthesis,
      cfg,
    };
  }

  it('aggregate: считает доли green/yellow/red и топ-3 красных', async () => {
    const { svc } = buildSvc({
      checkIns: [
        { sentiment: 'green', id: 'c1' },
        { sentiment: 'green', id: 'c2' },
        { sentiment: 'yellow', id: 'c3' },
        { sentiment: 'red', id: 'c4' },
      ],
      redCheckIns: [
        {
          id: 'c4',
          rawResponseText: 'застрял на ревью PR',
          person: { name: 'Иван' },
        },
      ],
      newBlockers: [{ id: 'b1', name: 'нет доступа к S3', confidence: '0.85' }],
    });
    const result = await svc.aggregate({
      tenantId: 't1',
      dateLocal: '2026-05-24',
    });
    expect(result.metrics.totalCheckIns).toBe(4);
    expect(result.metrics.greenShare).toBeCloseTo(0.5);
    expect(result.metrics.yellowShare).toBeCloseTo(0.25);
    expect(result.metrics.redShare).toBeCloseTo(0.25);
    expect(result.metrics.topRedCheckIns).toHaveLength(1);
    expect(result.metrics.topRedCheckIns[0]!.personName).toBe('Иван');
    expect(result.metrics.topRedCheckIns[0]!.excerpt).toContain('застрял');
    expect(result.metrics.newBlockers).toHaveLength(1);
    expect(result.metrics.newBlockers[0]!.confidence).toBeCloseTo(0.85);
    expect(result.sources.blockerIds).toEqual(['b1']);
  });

  it('generate: при валидном JSON от LLM пишет непустые verdict/letter/goalAlignmentDay', async () => {
    const validJson = JSON.stringify({
      verdict: {
        overall: {
          state: 'warn',
          emoji: '⚠️',
          title: 'День с трением',
          oneLiner: 'Команда в норме, но есть просрочки.',
        },
        axes: [
          { key: 'team', state: 'ok', label: 'Норма', why: 'настроение зелёное' },
          { key: 'clients', state: 'ok', label: 'Норма', why: 'спокойно' },
          { key: 'execution', state: 'warn', label: 'Буксует', why: 'просрочки' },
          { key: 'overall', state: 'warn', label: 'Трение', why: '1 жёлтая зона' },
        ],
      },
      letter: [{ key: 'main', title: 'Главное за день', prose: 'Сегодня прошло спокойно.' }],
      goalAlignmentDay: {
        direction: 'drift',
        score: 41,
        todayDelta: '+1 из 10',
        why: 'медленно',
        pro: ['есть движение'],
        contra: ['далеко до цели'],
      },
      risksSummary: 'Повторяется молчание поддержки.',
      ideasSummary: 'Растёт спрос на онбординг.',
    });
    const { svc, prisma, metrics } = buildSvc({
      checkIns: [{ sentiment: 'green', id: 'c1' }],
      llmResult: { text: validJson, modelUsed: 'deepseek:deepseek-chat' },
    });
    const result = await svc.generate({
      tenantId: 't1',
      dateLocal: '2026-05-24',
    });
    expect(result.verdict).not.toBeNull();
    expect(result.verdict!.overall.title).toBe('День с трением');
    expect(result.letter).not.toBeNull();
    expect(result.letter!.length).toBeGreaterThan(0);
    expect(result.goalAlignmentDay).not.toBeNull();
    expect(result.goalAlignmentDay!.direction).toBe('drift');
    expect(result.bodyMarkdown).toContain('День с трением');
    expect(result.shortSummary).toContain('Команда в норме');
    expect(result.llmTaskRouteId).toContain('deepseek:deepseek-chat');
    expect(prisma.dailyOperationsDigest.upsert).toHaveBeenCalledOnce();
    expect(metrics.incCooDailyDigestGenerated).toHaveBeenCalledOnce();
    expect(metrics.setCooDailyDigestAge).toHaveBeenCalledOnce();
  });

  it('generate: при провале LLM сохраняет fallback (verdict/letter/goalAlignmentDay null, llmTaskRouteId=null)', async () => {
    const { svc, metrics } = buildSvc({
      checkIns: [{ sentiment: 'red', id: 'c1' }],
      llmReject: new Error('LLM down'),
    });
    const result = await svc.generate({
      tenantId: 't1',
      dateLocal: '2026-05-24',
    });
    expect(result.bodyMarkdown).toContain('Ежедневный отчёт');
    expect(result.llmTaskRouteId).toBeNull();
    expect(result.verdict).toBeNull();
    expect(result.letter).toBeNull();
    expect(result.goalAlignmentDay).toBeNull();
    expect(result.shortSummary).toContain('Связный комментарий не сгенерирован');
    expect(metrics.incCooDailyDigestFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'llm_failed' }),
    );
    expect(metrics.incCooDailyDigestGenerated).toHaveBeenCalledOnce();
  });

  it('generate: битый JSON от LLM ⇒ fallback (поля null)', async () => {
    const { svc } = buildSvc({
      checkIns: [{ sentiment: 'green', id: 'c1' }],
      llmResult: { text: 'это не json', modelUsed: 'm' },
    });
    const result = await svc.generate({
      tenantId: 't1',
      dateLocal: '2026-05-24',
    });
    expect(result.verdict).toBeNull();
    expect(result.letter).toBeNull();
    expect(result.llmTaskRouteId).toBeNull();
    expect(result.bodyMarkdown).toContain('Ежедневный отчёт');
  });

  it('getOrGenerate: если запись уже есть — не вызывает LLM', async () => {
    const { svc, llm } = buildSvc({
      existing: {
        id: 'dd-exists',
        tenantId: 't1',
        dateLocal: '2026-05-24',
        bodyMarkdown: 'старый текст',
        metricsJson: {},
        sourcesJson: {},
        llmTaskRouteId: 'deepseek:deepseek-chat',
        shortSummary: 'было',
        deliveredAt: null,
        createdAt: new Date('2026-05-25T01:00:00Z'),
      },
    });
    const result = await svc.getOrGenerate({
      tenantId: 't1',
      dateLocal: '2026-05-24',
    });
    expect(result.bodyMarkdown).toBe('старый текст');
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('markDelivered: обновляет deliveredAt у дайджеста', async () => {
    const { svc, prisma } = buildSvc({});
    await svc.markDelivered({ tenantId: 't1', dateLocal: '2026-05-24' });
    expect(prisma.dailyOperationsDigest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', dateLocal: '2026-05-24' },
        data: expect.objectContaining({ deliveredAt: expect.any(Date) }),
      }),
    );
  });

  it('buildPendingActionsLine: total>0 → строка с количеством и /actions', async () => {
    const { svc, pendingActions } = buildSvc({});
    pendingActions.getCount.mockResolvedValueOnce({
      total: 4,
      bySource: { curation: 3, conflict: 1, intake: 0, probe: 0 },
    });
    const line = await svc.buildPendingActionsLine({
      tenantId: 't1',
      userId: 'u1',
    });
    expect(line).not.toBeNull();
    expect(line).toContain('4');
    expect(line).toContain('/actions');
  });

  it('buildPendingActionsLine: total=0 → null (блока нет)', async () => {
    const { svc } = buildSvc({});
    const line = await svc.buildPendingActionsLine({
      tenantId: 't1',
      userId: 'u1',
    });
    expect(line).toBeNull();
  });

  it('buildPendingActionsLine: ошибка PendingActionsService → null, не бросает', async () => {
    const { svc, pendingActions } = buildSvc({});
    pendingActions.getCount.mockRejectedValueOnce(new Error('db down'));
    const line = await svc.buildPendingActionsLine({
      tenantId: 't1',
      userId: 'u1',
    });
    expect(line).toBeNull();
  });

  it('listAvailablePeriods: DESC-порядок, stateHint/title из verdictJson, legacy→null, latest=первый', async () => {
    const { svc, prisma } = buildSvc({});
    prisma.dailyOperationsDigest.findMany.mockResolvedValueOnce([
      { dateLocal: '2026-06-28', verdictJson: { overall: { state: 'warn', title: 'Сдвиг вправо' } } },
      { dateLocal: '2026-06-27', verdictJson: { overall: { state: 'ok', title: 'Спокойно' } } },
      { dateLocal: '2026-06-26', verdictJson: null },
    ]);
    const result = await svc.listAvailablePeriods({ tenantId: 't1', limit: 12 });
    expect(result.rhythm).toBe('day');
    expect(result.periods.map((p) => p.period)).toEqual([
      '2026-06-28',
      '2026-06-27',
      '2026-06-26',
    ]);
    expect(result.periods[0]).toEqual({
      period: '2026-06-28',
      stateHint: 'warn',
      title: 'Сдвиг вправо',
    });
    expect(result.periods[2]).toEqual({ period: '2026-06-26', stateHint: null, title: null });
    expect(result.latest).toBe('2026-06-28');
  });
});
