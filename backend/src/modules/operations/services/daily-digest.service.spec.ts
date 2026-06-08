import { describe, expect, it, vi } from 'vitest';

import { DailyDigestService } from './daily-digest.service';

/**
 * SBA β-8.3 — DailyDigestService unit-тесты.
 *
 *   - aggregate: корректно собирает агрегаты из фикстур (доли green/yellow/red,
 *     топ-3 красных чек-ина, новые блокеры).
 *   - generate: при успехе LLM сохраняет связный bodyMarkdown + llmTaskRouteId
 *     + shortSummary (парсинг разделителя).
 *   - generate: при провале LLM сохраняет fallback markdown с llmTaskRouteId=null.
 *   - getOrGenerate: идемпотентен по `(tenantId, dateLocal)`.
 */
describe('DailyDigestService', () => {
  function buildSvc(overrides: {
    checkIns?: unknown[];
    redCheckIns?: unknown[];
    newBlockers?: unknown[];
    overdueCommitments?: unknown[];
    goals?: unknown[];
    highInsights?: unknown[];
    decisions?: unknown[];
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
          // 0 = чек-ины дня (sentiment-filtered);
          // 1 = topRedCheckIns (red-only, с person.name).
          if (i === 0) return Promise.resolve(overrides.checkIns ?? []);
          return Promise.resolve(overrides.redCheckIns ?? []);
        }),
      },
      ideaBlock: {
        findMany: vi.fn().mockImplementation(() => {
          const i = blockCallIndex++;
          // 0 = newBlockers; 1 = overdueCommitments.
          if (i === 0) return Promise.resolve(overrides.newBlockers ?? []);
          return Promise.resolve(overrides.overdueCommitments ?? []);
        }),
      },
      goal: {
        findMany: vi.fn().mockResolvedValue(overrides.goals ?? []),
      },
      insight: {
        findMany: vi.fn().mockResolvedValue(overrides.highInsights ?? []),
      },
      decision: {
        findMany: vi.fn().mockResolvedValue(overrides.decisions ?? []),
      },
      // Pulse Wave 2 §2.1 — stubs для enrichDto/computeRuntimeSections.
      meeting: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      person: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      dailyOperationsDigest: {
        findUnique: vi.fn().mockResolvedValue(overrides.existing ?? null),
        findFirst: vi.fn().mockResolvedValue(overrides.latest ?? null),
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
              text:
                '# Сводка\n\nВсё хорошо.\n\n---SHORT_SUMMARY---\nВчера 5 чек-инов, всё в норме.',
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
    const svc = new DailyDigestService(
      prisma as never,
      llm as never,
      metrics as never,
      pendingActions as never,
      customerRisk as never,
    );
    return { svc, prisma, llm, metrics, pendingActions, customerRisk };
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
      newBlockers: [
        { id: 'b1', name: 'нет доступа к S3', confidence: '0.85' },
      ],
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

  it('generate: при успехе LLM сохраняет bodyMarkdown, shortSummary и llmTaskRouteId', async () => {
    const { svc, prisma, metrics } = buildSvc({
      checkIns: [{ sentiment: 'green', id: 'c1' }],
      llmResult: {
        text:
          '## Сводка\nВсё ок.\n\n---SHORT_SUMMARY---\nКороткая выжимка для Telegram.',
        modelUsed: 'deepseek:deepseek-chat',
      },
    });
    const result = await svc.generate({
      tenantId: 't1',
      dateLocal: '2026-05-24',
    });
    expect(result.bodyMarkdown).toContain('Сводка');
    expect(result.bodyMarkdown).not.toContain('SHORT_SUMMARY');
    expect(result.shortSummary).toContain('Короткая выжимка');
    expect(result.llmTaskRouteId).toContain('deepseek:deepseek-chat');
    expect(prisma.dailyOperationsDigest.upsert).toHaveBeenCalledOnce();
    expect(metrics.incCooDailyDigestGenerated).toHaveBeenCalledOnce();
    expect(metrics.setCooDailyDigestAge).toHaveBeenCalledOnce();
  });

  it('generate: при провале LLM сохраняет fallback (llmTaskRouteId=null)', async () => {
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
    expect(result.shortSummary).toContain('Связный комментарий не сгенерирован');
    expect(metrics.incCooDailyDigestFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'llm_failed' }),
    );
    // generated тоже инкрементится (сухой вариант — это всё ещё сохранённый дайджест).
    expect(metrics.incCooDailyDigestGenerated).toHaveBeenCalledOnce();
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

  // ───────────── Action Center B3 — блок «Ждёт подтверждения» ─────────────

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
});
