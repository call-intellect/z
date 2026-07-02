import { describe, expect, it, vi } from 'vitest';

import { DailyDigestService } from './daily-digest.service';

const TENANT = 't1';
const DATE = '2026-06-30';

function buildV2Json(): string {
  return JSON.stringify({
    verdict: {
      overall: {
        state: 'warn',
        emoji: '⚠️',
        title: 'День с трением',
        oneLiner: 'Команда движется, но есть отставание по отчётам.',
      },
      axes: [
        { key: 'team', state: 'ok', label: 'Норма', why: 'настроение зелёное' },
        { key: 'clients', state: 'ok', label: 'Норма', why: 'клиенты спокойны' },
        { key: 'execution', state: 'warn', label: 'Буксует', why: 'половина без отчёта' },
        { key: 'overall', state: 'warn', label: 'Трение', why: 'исполнение просело' },
      ],
    },
    letter: [
      { key: 'intro', title: 'Вступление', prose: 'Добрый вечер. День прошёл рабочим.' },
      { key: 'main', title: 'Главное за день', prose: 'Активная переписка, есть отставание.' },
      { key: 'reporting', title: 'План и факт', prose: 'План сдали 5 из 6, отчёт — 3 из 6.' },
      { key: 'blocked', title: 'Заблокировано', prose: 'Один растущий риск в поддержке.' },
      { key: 'attention', title: 'Требует внимания', prose: 'Конфликт между двумя людьми.' },
      { key: 'reflection', title: 'Рефлексия', prose: 'Завтра дожать отчёты.' },
    ],
    goalAlignmentDay: {
      direction: 'drift',
      score: 44,
      todayDelta: '+1 из 10',
      why: 'медленное движение к цели',
      pro: ['есть идеи роста'],
      contra: ['исполнение буксует'],
    },
    risksSummary: 'Растёт молчание поддержки — риск оттока.',
    ideasSummary: 'Команда предлагает ускорить онбординг.',
  });
}

function buildSvc() {
  let checkInCallIndex = 0;
  let ideaBlockCallIndex = 0;

  const checkInsAggregate = [
    { sentiment: 'green', id: 'ci-g1' },
    { sentiment: 'green', id: 'ci-g2' },
    { sentiment: 'green', id: 'ci-g3' },
    { sentiment: 'yellow', id: 'ci-y1' },
    { sentiment: 'red', id: 'ci-r1' },
  ];

  const reportingCheckIns = [
    { personId: 'e1', kind: 'morning', plansJson: [{ text: 'a' }, { text: 'b' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп1', relationship: 'employee' } },
    { personId: 'e1', kind: 'evening', plansJson: null, donesJson: [{ text: 'a' }], notDoneJson: [{ text: 'b не сделал' }], reportCompleteness: 'full', person: { name: 'Емп1', relationship: 'employee' } },
    { personId: 'e2', kind: 'morning', plansJson: [{ text: 'x' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп2', relationship: 'employee' } },
    { personId: 'e2', kind: 'evening', plansJson: null, donesJson: [{ text: 'x' }], notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп2', relationship: 'employee' } },
    { personId: 'e3', kind: 'morning', plansJson: [{ text: 'y' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп3', relationship: 'employee' } },
    { personId: 'e3', kind: 'evening', plansJson: null, donesJson: [{ text: 'y' }], notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп3', relationship: 'employee' } },
    { personId: 'e4', kind: 'morning', plansJson: [{ text: 'z' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп4', relationship: 'employee' } },
    { personId: 'e5', kind: 'morning', plansJson: [{ text: 'w' }], donesJson: null, notDoneJson: null, reportCompleteness: 'full', person: { name: 'Емп5', relationship: 'employee' } },
  ];

  const employees = [
    { id: 'e1', name: 'Емп1' },
    { id: 'e2', name: 'Емп2' },
    { id: 'e3', name: 'Емп3' },
    { id: 'e4', name: 'Емп4' },
    { id: 'e5', name: 'Емп5' },
    { id: 'e6', name: 'Емп6' },
  ];

  const growingRisk = [
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
  ];

  const ideas = [
    { id: 'i1', statement: 'Ускорить онбординг', supporterCount: 3, weight: '0.9', status: 'captured', clusterId: null },
    { id: 'i2', statement: 'Добавить дашборд', supporterCount: 1, weight: '0.5', status: 'captured', clusterId: 'c1' },
  ];

  const prisma = {
    dailyCheckIn: {
      findMany: vi.fn().mockImplementation(() => {
        const i = checkInCallIndex++;
        if (i === 0) return Promise.resolve(checkInsAggregate);
        if (i === 1) return Promise.resolve([{ id: 'ci-r1', rawResponseText: 'застрял на релизе', person: { name: 'Емп1' } }]);
        return Promise.resolve(reportingCheckIns);
      }),
    },
    ideaBlock: {
      findMany: vi.fn().mockImplementation(() => {
        const i = ideaBlockCallIndex++;
        if (i === 0) return Promise.resolve([{ id: 'blk1', name: 'нет доступа к S3', confidence: '0.85' }]);
        return Promise.resolve([]);
      }),
    },
    goal: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    goalAlignmentSnapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    idea: {
      findMany: vi.fn().mockResolvedValue(ideas),
    },
    insight: {
      findMany: vi.fn().mockResolvedValue(growingRisk),
    },
    meeting: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    person: {
      findMany: vi.fn().mockResolvedValue(employees),
    },
    ideaBlockEvidence: {
      findMany: vi.fn().mockResolvedValue([
        {
          authorPersonId: 'e1',
          sourceTimestamp: new Date('2026-06-30T09:00:00Z'),
          block: { signalType: 'idea', name: 'Идея A', trustedAnswer: 'Ускорить онбординг' },
        },
        {
          authorPersonId: 'e2',
          sourceTimestamp: new Date('2026-06-30T10:00:00Z'),
          block: { signalType: 'risk', name: 'Риск B', trustedAnswer: 'Поддержка молчит' },
        },
      ]),
    },
    bitrixMessage: {
      findMany: vi.fn().mockResolvedValue([
        {
          sessionId: 's1',
          dialogId: 'd1',
          authorExternalId: 'ext-emp',
          authorName: 'Менеджер',
          externalCreatedAt: new Date('2026-06-30T08:00:00Z'),
          text: 'Здравствуйте, оформляю вашу заявку.',
        },
        {
          sessionId: 's1',
          dialogId: 'd1',
          authorExternalId: 'ext-emp',
          authorName: 'Менеджер',
          externalCreatedAt: new Date('2026-06-30T08:05:00Z'),
          text: 'Всё готово, спасибо за обращение.',
        },
      ]),
    },
    chatboxMessage: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dailyOperationsDigest: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(
        ({
          create,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const unwrapJson = (v: unknown) =>
            v === null || v === undefined || String(v) === 'Prisma.JsonNull' ? null : v;
          return Promise.resolve({
            id: 'dd1',
            tenantId: TENANT,
            dateLocal: DATE,
            bodyMarkdown: (create.bodyMarkdown as string) ?? '',
            metricsJson: create.metricsJson,
            sourcesJson: create.sourcesJson,
            llmTaskRouteId: (create.llmTaskRouteId as string | null) ?? null,
            shortSummary: (create.shortSummary as string | null) ?? null,
            deliveredAt: null,
            createdAt: new Date('2026-07-01T01:00:00Z'),
            verdictJson: unwrapJson(create.verdictJson),
            letterJson: unwrapJson(create.letterJson),
            goalAlignmentDayJson: unwrapJson(create.goalAlignmentDayJson),
          });
        },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const llm = {
    call: vi.fn().mockResolvedValue({ text: buildV2Json(), modelUsed: 'deepseek-v4-pro' }),
  };

  const metrics = {
    incCooDailyDigestGenerated: vi.fn(),
    incCooDailyDigestFailed: vi.fn(),
    incCooDailyDigestDelivered: vi.fn(),
    setCooDailyDigestAge: vi.fn(),
    setCooDailyDigestPackageChars: vi.fn(),
    incCooDailyDigestModelUsed: vi.fn(),
    setCooDailyDigestConflictsFed: vi.fn(),
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
    getTeamFrictions: vi.fn().mockResolvedValue({
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
          observedAt: '2026-06-30T12:00:00Z',
        },
      ],
      total: 1,
    }),
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

  return { svc, prisma, llm, metrics };
}

describe('DailyDigestService — День компании v2 e2e (mocked LLM)', () => {
  it('синтетический день → сохраняет verdict/letter, роутит на deepseek-v4-pro, шлёт метрики v2, letter без decisions', async () => {
    const { svc, prisma, metrics } = buildSvc();

    const result = await svc.generate({ tenantId: TENANT, dateLocal: DATE });

    expect(prisma.dailyOperationsDigest.upsert).toHaveBeenCalledOnce();
    const upsertArg = prisma.dailyOperationsDigest.upsert.mock.calls[0]![0] as {
      create: { verdictJson: unknown; letterJson: unknown; llmTaskRouteId: string | null };
    };
    expect(upsertArg.create.verdictJson).not.toBeNull();
    expect(upsertArg.create.letterJson).not.toBeNull();

    const savedLetter = upsertArg.create.letterJson as Array<{ key: string }>;
    expect(savedLetter.some((s) => s.key === 'decisions')).toBe(false);
    expect(savedLetter.some((s) => s.key === 'reporting')).toBe(true);

    expect(result.llmTaskRouteId).toContain('deepseek-v4-pro');
    expect(upsertArg.create.llmTaskRouteId).toContain('deepseek-v4-pro');

    expect(result.verdict).not.toBeNull();
    expect(result.verdict!.overall.title).toBe('День с трением');
    expect(result.goalAlignmentDay).not.toBeNull();
    expect(result.goalAlignmentDay!.direction).toBe('drift');

    expect(metrics.incCooDailyDigestModelUsed).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'deepseek-v4-pro' }),
    );
    expect(metrics.setCooDailyDigestConflictsFed).toHaveBeenCalledWith(
      expect.objectContaining({ value: 1 }),
    );
    expect(metrics.setCooDailyDigestPackageChars).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.any(Number) }),
    );
    expect(metrics.incCooDailyDigestGenerated).toHaveBeenCalledOnce();
  });
});
