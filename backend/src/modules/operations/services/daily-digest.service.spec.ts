import { describe, expect, it, vi } from 'vitest';

import { DailyDigestService } from './daily-digest.service';

describe('DailyDigestService', () => {
  function buildSvc(overrides: {
    checkIns?: unknown[];
    redCheckIns?: unknown[];
    newBlockers?: unknown[];
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
          return Promise.resolve([]);
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
      ideaBlockEvidence: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      bitrixMessage: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      chatboxMessage: {
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
      getDynamic: vi
        .fn()
        .mockImplementation((_key: string, _env: string | undefined, def: unknown) => def),
    };
    const personRefResolver = {
      create: vi.fn().mockResolvedValue({
        resolve: vi.fn().mockImplementation((input: { personId?: string; isClient?: boolean }) => ({
          personId: input.isClient ? null : (input.personId ?? null),
          isClient: input.isClient === true,
          personName: input.personId ? `Персона ${input.personId}` : null,
        })),
      }),
    };
    const opsDashboard = {
      getTeamFrictions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const svc = new DailyDigestService(
      prisma as never,
      llm as never,
      metrics as never,
      pendingActions as never,
      customerRisk as never,
      blockerSynthesis as never,
      cfg as never,
      personRefResolver as never,
      opsDashboard as never,
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
      personRefResolver,
      opsDashboard,
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

  describe('buildDayPackage', () => {
    it('собирает голос сотрудников, сырые переписки, сигналы, конфликты, план↔факт', async () => {
      const { svc, prisma, opsDashboard } = buildSvc({});

      prisma.ideaBlockEvidence.findMany.mockResolvedValueOnce([
        {
          authorPersonId: 'p1',
          sourceTimestamp: new Date('2026-05-24T09:00:00Z'),
          block: { signalType: 'idea', name: 'Идея A', trustedAnswer: 'Сделать A' },
        },
        {
          authorPersonId: 'p1',
          sourceTimestamp: new Date('2026-05-24T10:00:00Z'),
          block: { signalType: 'risk', name: 'Риск B', trustedAnswer: 'Опасность B' },
        },
      ]);

      prisma.bitrixMessage.findMany.mockResolvedValueOnce([
        {
          sessionId: 's1',
          dialogId: 'd1',
          authorExternalId: 'ext-emp',
          authorName: 'Менеджер',
          externalCreatedAt: new Date('2026-05-24T08:00:00Z'),
          text: 'Здравствуйте, чем помочь?',
        },
        {
          sessionId: 's1',
          dialogId: 'd1',
          authorExternalId: 'ext-emp',
          authorName: 'Менеджер',
          externalCreatedAt: new Date('2026-05-24T08:05:00Z'),
          text: 'Оформляю заявку.',
        },
      ]);

      prisma.idea.findMany.mockResolvedValue([
        { id: 'i1', statement: 'Идея-1', supporterCount: 3, weight: '0.9', status: 'captured', clusterId: null },
        { id: 'i2', statement: 'Идея-2', supporterCount: 1, weight: '0.5', status: 'captured', clusterId: 'c1' },
      ]);

      prisma.insight.findMany.mockResolvedValue([
        {
          id: 'ins1',
          kind: 'risk',
          statement: 'Растёт молчание поддержки',
          causeCategory: 'communication',
          dynamicLabel: 'growing',
          sourceBlockIds: ['b1', 'b2'],
          frequencyScore: '0.7',
          status: 'active',
          severity: 'high',
        },
      ]);

      prisma.ideaBlock.findMany.mockResolvedValue([]);

      prisma.dailyCheckIn.findMany.mockResolvedValueOnce([
        { personId: 'e1', kind: 'morning', plansJson: [{ text: 'a' }, { text: 'b' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп1', relationship: 'employee' } },
        { personId: 'e1', kind: 'evening', plansJson: null, donesJson: [{ text: 'a' }], notDoneJson: [{ text: 'b не сделал' }], reportCompleteness: 'full', person: { name: 'Емп1', relationship: 'employee' } },
        { personId: 'e2', kind: 'morning', plansJson: [{ text: 'x' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп2', relationship: 'employee' } },
        { personId: 'e2', kind: 'evening', plansJson: null, donesJson: [{ text: 'x' }], notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп2', relationship: 'employee' } },
        { personId: 'e3', kind: 'morning', plansJson: [{ text: 'y' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп3', relationship: 'employee' } },
        { personId: 'e3', kind: 'evening', plansJson: null, donesJson: [{ text: 'y' }], notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп3', relationship: 'employee' } },
        { personId: 'e4', kind: 'morning', plansJson: [{ text: 'z' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп4', relationship: 'employee' } },
        { personId: 'e5', kind: 'morning', plansJson: [{ text: 'w' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп5', relationship: 'employee' } },
      ]);

      prisma.person.findMany.mockResolvedValueOnce([
        { id: 'e1', name: 'Емп1' },
        { id: 'e2', name: 'Емп2' },
        { id: 'e3', name: 'Емп3' },
        { id: 'e4', name: 'Емп4' },
        { id: 'e5', name: 'Емп5' },
        { id: 'e6', name: 'Емп6' },
      ]);

      opsDashboard.getTeamFrictions.mockResolvedValueOnce({
        items: [
          {
            id: 'f1',
            fromPersonId: 'e1',
            fromPersonName: 'Емп1',
            toPersonId: 'e2',
            toPersonName: 'Емп2',
            relationType: 'in_conflict_with',
            confidence: 0.8,
            explanation: 'спор о приоритетах',
            observedAt: '2026-05-24T12:00:00Z',
          },
        ],
        total: 1,
      });

      const pkg = await (svc as never as { buildDayPackage: (a: { tenantId: string; dateLocal: string }) => Promise<Record<string, unknown>> }).buildDayPackage({
        tenantId: 't1',
        dateLocal: '2026-05-24',
      });

      const employeeVoice = pkg.employeeVoice as Array<{ personId: string; ideas: unknown[]; risks: unknown[] }>;
      expect(employeeVoice.length).toBeGreaterThan(0);
      expect(employeeVoice[0]!.ideas.length).toBe(1);
      expect(employeeVoice[0]!.risks.length).toBe(1);

      const raw = pkg.rawConversations as { bitrix: Array<{ session: string; turns: unknown[] }> };
      expect(raw.bitrix.length).toBe(1);
      expect(raw.bitrix[0]!.turns.length).toBe(2);

      const signals = pkg.signals as {
        risks: Array<{ dynamicLabel: string }>;
        ideas: unknown[];
      };
      expect(signals.risks.some((r) => r.dynamicLabel === 'growing')).toBe(true);
      expect(signals.ideas.length).toBe(2);

      const conflicts = pkg.conflicts as Array<{ fromPersonName: string; toPersonName: string }>;
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.fromPersonName).toBe('Емп1');
      expect(conflicts[0]!.toPersonName).toBe('Емп2');

      const reporting = pkg.reporting as {
        planSubmitted: { done: number; total: number };
        reportSubmitted: { done: number; total: number };
      };
      expect(reporting.planSubmitted.done).toBe(5);
      expect(reporting.planSubmitted.total).toBe(6);
      expect(reporting.reportSubmitted.done).toBe(3);
    });

    it('клиент в чатбоксе → turn.isClient=true, personId=null; ассистент пропускается', async () => {
      const { svc, prisma } = buildSvc({});
      prisma.chatboxMessage.findMany.mockResolvedValueOnce([
        {
          sessionId: 'cs1',
          chatId: 'ch1',
          senderType: 'CLIENT',
          senderExternalId: 'ext-client',
          senderName: 'Клиент Пётр',
          externalCreatedAt: new Date('2026-05-24T07:00:00Z'),
          text: 'У меня вопрос по счёту.',
        },
        {
          sessionId: 'cs1',
          chatId: 'ch1',
          senderType: 'ASSISTANT',
          senderExternalId: null,
          senderName: 'Кора',
          externalCreatedAt: new Date('2026-05-24T07:01:00Z'),
          text: 'Отвечаю ботом — должно быть пропущено.',
        },
      ]);

      const pkg = await (svc as never as { buildDayPackage: (a: { tenantId: string; dateLocal: string }) => Promise<Record<string, unknown>> }).buildDayPackage({
        tenantId: 't1',
        dateLocal: '2026-05-24',
      });

      const raw = pkg.rawConversations as {
        chatbox: Array<{ turns: Array<{ isClient: boolean; personId: string | null }> }>;
      };
      expect(raw.chatbox.length).toBe(1);
      expect(raw.chatbox[0]!.turns.length).toBe(1);
      expect(raw.chatbox[0]!.turns[0]!.isClient).toBe(true);
      expect(raw.chatbox[0]!.turns[0]!.personId).toBeNull();
    });

    it('переполнение бюджета символов → пакет не падает, текст обрезан', async () => {
      const { svc, prisma, cfg } = buildSvc({});
      cfg.getDynamic.mockImplementation(
        (key: string, _env: string | undefined, def: unknown) =>
          key === 'operations.daily_digest.raw_char_budget' ? 10 : def,
      );
      const long = 'а'.repeat(200);
      prisma.bitrixMessage.findMany.mockResolvedValueOnce([
        {
          sessionId: 's1',
          dialogId: 'd1',
          authorExternalId: 'ext-emp',
          authorName: 'Менеджер',
          externalCreatedAt: new Date('2026-05-24T08:00:00Z'),
          text: long,
        },
        {
          sessionId: 's1',
          dialogId: 'd1',
          authorExternalId: 'ext-emp',
          authorName: 'Менеджер',
          externalCreatedAt: new Date('2026-05-24T09:00:00Z'),
          text: long,
        },
      ]);

      const pkg = await (svc as never as { buildDayPackage: (a: { tenantId: string; dateLocal: string }) => Promise<Record<string, unknown>> }).buildDayPackage({
        tenantId: 't1',
        dateLocal: '2026-05-24',
      });

      const raw = pkg.rawConversations as { bitrix: Array<{ turns: Array<{ text: string }> }> };
      const totalChars = raw.bitrix.reduce(
        (acc, s) => acc + s.turns.reduce((a, t) => a + t.text.length, 0),
        0,
      );
      expect(totalChars).toBeLessThanOrEqual(10);
    });
  });
});
