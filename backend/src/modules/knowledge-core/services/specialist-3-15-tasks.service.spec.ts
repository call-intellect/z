import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist315TasksService } from './specialist-3-15-tasks.service';

const TENANT = 'org-1';
const BLOCK_ID = 'block-1';

interface MockLlmResponse {
  text: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  tier: 'primary';
}

function llmResult(obj: unknown): MockLlmResponse {
  return {
    text: JSON.stringify(obj),
    modelUsed: 'deepseek:deepseek-v4-pro',
    inputTokens: 10,
    outputTokens: 10,
    cachedTokens: 0,
    durationMs: 1,
    tier: 'primary',
  };
}

function taskJson(overrides: Record<string, unknown> = {}) {
  return {
    isTask: true,
    title: 'Подготовить смету по проекту Альфа',
    sourceQuote: 'подготовь к пятнице смету по проекту Альфа',
    assigneeHint: 'Сергей',
    dueHint: '',
    priorityHint: 'medium',
    confidence: 0.9,
    ...overrides,
  };
}

function makeBlock(sourceType: string, overrides: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    tenantId: TENANT,
    name: 'Переписка с клиентом',
    criticalQuestion: 'Что нужно сделать?',
    trustedAnswer: 'Подготовить смету',
    signalType: 'action_item',
    tags: [],
    dataClass: 'internal',
    evidence: [{ quote: 'подготовь смету', sourceType }],
    ...overrides,
  };
}

interface Mocks {
  prisma: {
    org: { findMany: ReturnType<typeof vi.fn> };
    ideaBlock: { findUnique: ReturnType<typeof vi.fn> };
    intakeIssue: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    issue: { findFirst: ReturnType<typeof vi.fn> };
    taskSource: { create: ReturnType<typeof vi.fn> };
    membership: { findFirst: ReturnType<typeof vi.fn> };
    person: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };
  llm: { call: ReturnType<typeof vi.fn> };
  metrics: {
    incCoreSpecialistCards: ReturnType<typeof vi.fn>;
    incCoreSpecialistSkipped: ReturnType<typeof vi.fn>;
    observeCoreSpecialistPipelineDuration: ReturnType<typeof vi.fn>;
    incCoreSpecialistLlmTokens: ReturnType<typeof vi.fn>;
    incCoreSpecialistExtractionFailure: ReturnType<typeof vi.fn>;
  };
  logs: { write: ReturnType<typeof vi.fn> };
  assigneeResolver: { resolve: ReturnType<typeof vi.fn> };
  cfg: {
    getDynamic: ReturnType<typeof vi.fn>;
    pendingActions: { intakeTtlDays: number };
    tracker: {
      assigneeClarifyEnabled: boolean;
      dueDateClarifyEnabled: boolean;
      assigneeProbePriorityHint: number;
    };
    aiFeatures: { promptInjectionGuardEnabled: boolean };
  };
  autoTriageQueue: { enqueue: ReturnType<typeof vi.fn> };
  probe: { suggest: ReturnType<typeof vi.fn> };
  taskDedup: { evaluate: ReturnType<typeof vi.fn> };
}

function buildService(linkSemantics: 'link' | 'delete' = 'link'): {
  svc: Specialist315TasksService;
  m: Mocks;
} {
  const m: Mocks = {
    prisma: {
      org: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlock: { findUnique: vi.fn() },
      intakeIssue: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'intake-new' }),
      },
      issue: { findFirst: vi.fn().mockResolvedValue(null) },
      taskSource: { create: vi.fn().mockResolvedValue({ id: 'ts-1' }) },
      membership: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'owner-1' }),
      },
      person: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn(),
    },
    llm: { call: vi.fn() },
    metrics: {
      incCoreSpecialistCards: vi.fn(),
      incCoreSpecialistSkipped: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
      incCoreSpecialistExtractionFailure: vi.fn(),
    },
    logs: { write: vi.fn() },
    assigneeResolver: {
      resolve: vi
        .fn()
        .mockResolvedValue({ kind: 'resolved', userId: 'user-7', name: 'Сергей', via: 'name' }),
    },
    cfg: {
      getDynamic: vi
        .fn()
        .mockImplementation(
          (key: string, _env: string | undefined, def: unknown) =>
            key === 'tracker.taskDedupLinkSemantics' ? linkSemantics : def,
        ),
      pendingActions: { intakeTtlDays: 14 },
      tracker: {
        assigneeClarifyEnabled: true,
        dueDateClarifyEnabled: true,
        assigneeProbePriorityHint: 0.5,
      },
      aiFeatures: { promptInjectionGuardEnabled: true },
    },
    autoTriageQueue: { enqueue: vi.fn().mockResolvedValue(undefined) },
    probe: { suggest: vi.fn().mockResolvedValue({ ok: true, probeEventId: 'p1' }) },
    taskDedup: {
      evaluate: vi
        .fn()
        .mockResolvedValue({ verdict: 'different', matchedIssueId: null }),
    },
  };

  m.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(m.prisma),
  );

  const svc = new Specialist315TasksService(

    m.prisma as any,

    m.llm as any,

    m.metrics as any,

    m.logs as any,

    m.assigneeResolver as any,

    m.cfg as any,

    m.autoTriageQueue as any,

    m.probe as any,

    m.taskDedup as any,
  );
  return { svc, m };
}

describe('Specialist315TasksService.processBlock', () => {
  let svc: Specialist315TasksService;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('(a) chatbox action_item, isTask+resolved → IntakeIssue + enqueue', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.intakeIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'chatbox',
          sourceBlockIds: [BLOCK_ID],
          suggestedAssigneeId: 'user-7',
        }),
      }),
    );
    expect(m.autoTriageQueue.enqueue).toHaveBeenCalledWith({
      tenantId: TENANT,
      intakeIssueId: 'intake-new',
    });
  });

  it('(b) идемпотентность: блок уже материализован → create НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));
    m.prisma.intakeIssue.findFirst.mockResolvedValue({ id: 'existing' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
  });

  it('(c) isTask=false → create НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(
      llmResult(taskJson({ isTask: false, confidence: 0.1 })),
    );

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
  });

  it('(d) confidence ниже порога (0.45) → create НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson({ confidence: 0.3 })));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
  });

  it('(e) meeting-блок → create НЕ вызван + skip-метрика', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('meeting'));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(m.llm.call).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'meeting_handled_elsewhere' }),
    );
  });

  it('(e2) cross-source merge (chatbox + meeting) → create НЕ вызван + skip-метрика', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          { quote: 'из чата', sourceType: 'chatbox' },
          { quote: 'со встречи', sourceType: 'meeting' },
        ],
      }),
    );

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(m.llm.call).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'meeting_handled_elsewhere' }),
    );
  });

  it('(e3) meeting_report-блок → create НЕ вызван + skip-метрика', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('meeting_report'));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(m.llm.call).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'meeting_handled_elsewhere' }),
    );
  });

  it('(f) assignee not_found → create с suggestedAssigneeId:null + probe.suggest с recipient владельца', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));
    m.assigneeResolver.resolve.mockResolvedValue({ kind: 'not_found' });
    m.prisma.membership.findFirst.mockResolvedValue({ userId: 'owner-1' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ suggestedAssigneeId: null }),
      }),
    );
    expect(m.probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.assignee_unresolved',
        emittedByService: 'specialist-3-15-tasks',
        recipientCandidates: ['owner-1'],
      }),
    );
  });

  it('(f2) assignee not_found, владелец не найден → IntakeIssue создан, probe.suggest НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));
    m.assigneeResolver.resolve.mockResolvedValue({ kind: 'not_found' });
    m.prisma.membership.findFirst.mockResolvedValue(null);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(m.probe.suggest).not.toHaveBeenCalled();
  });

  it('(p) автор реплики определён → probe адресован автору, НЕ владельцу', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          {
            quote: 'подготовь смету',
            sourceType: 'chatbox',
            authorPersonId: 'p-setter',
          },
        ],
      }),
    );
    m.llm.call.mockResolvedValueOnce(
      llmResult(taskJson({ sourceQuote: 'подготовь смету' })),
    );
    m.assigneeResolver.resolve.mockResolvedValue({ kind: 'not_found' });
    m.prisma.person.findFirst.mockResolvedValue({ userId: 'user-setter' });
    m.prisma.membership.findFirst.mockResolvedValue({ userId: 'owner-1' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          id: 'p-setter',
          userId: { not: null },
        }),
      }),
    );
    expect(m.probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.assignee_unresolved',
        recipientCandidates: ['user-setter'],
      }),
    );
    expect(m.probe.suggest).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipientCandidates: ['owner-1'] }),
    );
  });

  it('(q) автор без userId → фолбэк owner', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          {
            quote: 'подготовь смету',
            sourceType: 'chatbox',
            authorPersonId: 'p-setter',
          },
        ],
      }),
    );
    m.llm.call.mockResolvedValueOnce(
      llmResult(taskJson({ sourceQuote: 'подготовь смету' })),
    );
    m.assigneeResolver.resolve.mockResolvedValue({ kind: 'not_found' });
    m.prisma.person.findFirst.mockResolvedValue(null);
    m.prisma.membership.findFirst.mockResolvedValue({ userId: 'owner-1' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.assignee_unresolved',
        recipientCandidates: ['owner-1'],
      }),
    );
  });

  it('(r) tenant-изоляция: автор из другого Org не матчится → фолбэк owner', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          {
            quote: 'подготовь смету',
            sourceType: 'chatbox',
            authorPersonId: 'p-foreign',
          },
        ],
      }),
    );
    m.llm.call.mockResolvedValueOnce(
      llmResult(taskJson({ sourceQuote: 'подготовь смету' })),
    );
    m.assigneeResolver.resolve.mockResolvedValue({ kind: 'not_found' });
    m.prisma.person.findFirst.mockResolvedValue(null);
    m.prisma.membership.findFirst.mockResolvedValue({ userId: 'owner-1' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
      }),
    );
    expect(m.probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.assignee_unresolved',
        recipientCandidates: ['owner-1'],
      }),
    );
  });

  it('(g) generic-API канал (external) → create с source:api (новый канал без нового кода)', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('external'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson({ assigneeHint: '' })));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'api' }),
      }),
    );
  });

  it('(h) LINK + dedup verdict=same → linkTaskSource, intakeIssue.create НЕ вызван, enqueue НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));
    m.taskDedup.evaluate.mockResolvedValue({
      verdict: 'same',
      matchedIssueId: 'iss-1',
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.taskSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issueId: 'iss-1',
          sourceType: 'chatbox',
          sourceRefId: BLOCK_ID,
        }),
      }),
    );
    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(m.autoTriageQueue.enqueue).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'linked_existing_issue' }),
    );
  });

  it('(i) LINK + dedup different + exact-title re-check null + нет pending → create + enqueue', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));
    m.taskDedup.evaluate.mockResolvedValue({
      verdict: 'different',
      matchedIssueId: null,
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(m.autoTriageQueue.enqueue).toHaveBeenCalledWith({
      tenantId: TENANT,
      intakeIssueId: 'intake-new',
    });
    expect(m.prisma.taskSource.create).not.toHaveBeenCalled();
  });

  it('(j) LINK + race: exact-title re-check вернул открытый Issue → link, create НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));
    m.taskDedup.evaluate.mockResolvedValue({
      verdict: 'different',
      matchedIssueId: null,
    });
    m.prisma.issue.findFirst.mockResolvedValue({ id: 'iss-2' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.taskSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ issueId: 'iss-2' }),
      }),
    );
    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
  });

  it('(k) LINK + pending IntakeIssue с тем же title → create НЕ вызван (dedup_pending)', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));
    m.taskDedup.evaluate.mockResolvedValue({
      verdict: 'different',
      matchedIssueId: null,
    });
    m.prisma.intakeIssue.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'intake-pending' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(m.autoTriageQueue.enqueue).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'dedup_pending_intake' }),
    );
  });

  it('(l) DELETE/legacy режим → dedup.evaluate НЕ вызван, intakeIssue.create вызван', async () => {
    ({ svc, m } = buildService('delete'));
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.taskDedup.evaluate).not.toHaveBeenCalled();
    expect(m.prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.taskSource.create).not.toHaveBeenCalled();
  });

  it('(m) evidence с authorLabel → label попадает в userMessage для LLM', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          {
            quote: 'подготовь смету по проекту Альфа',
            sourceType: 'chatbox',
            authorPersonId: null,
            authorLabel: 'Клиент [Пётр]',
          },
        ],
      }),
    );
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.llm.call).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining('Клиент [Пётр]'),
      }),
    );
    expect(m.llm.call).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining('автор: Клиент [Пётр]'),
      }),
    );
    expect(m.prisma.person.findMany).not.toHaveBeenCalled();
  });

  it('(n) evidence с authorPersonId без label → имя Person резолвится и попадает в userMessage', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          {
            quote: 'подготовь смету по проекту Альфа',
            sourceType: 'chatbox',
            authorPersonId: 'p-manager',
            authorLabel: null,
          },
        ],
      }),
    );
    m.prisma.person.findMany.mockResolvedValue([
      { id: 'p-manager', name: 'Сергей Менеджеров' },
    ]);
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.person.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          id: { in: ['p-manager'] },
        }),
      }),
    );
    expect(m.llm.call).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining('автор: Сергей Менеджеров'),
      }),
    );
  });

  it('(o) evidence без авторства → userMessage без « — автор:» (нет регрессии)', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    const callArg = m.llm.call.mock.calls[0]![0] as { userMessage: string };
    expect(callArg.userMessage).not.toContain('— автор:');
    expect(m.prisma.person.findMany).not.toHaveBeenCalled();
  });

  it('advisory-lock через $executeRaw — путь создания задачи не бросает (Prisma 7 void fix)', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson()));

    await expect(
      svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID }),
    ).resolves.not.toThrow();

    expect(m.prisma.$executeRaw).toHaveBeenCalled();
    const sqlArg = m.prisma.$executeRaw.mock.calls[0]![0] as TemplateStringsArray;
    expect(sqlArg.join('')).toContain('pg_advisory_xact_lock');
    expect(m.prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
  });

  it('(s) срок не извлечён, исполнитель ЕСТЬ → due-probe постановщику', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          {
            quote: 'подготовь смету',
            sourceType: 'chatbox',
            authorPersonId: 'p-setter',
          },
        ],
      }),
    );
    m.llm.call.mockResolvedValueOnce(
      llmResult(taskJson({ sourceQuote: 'подготовь смету', dueHint: '' })),
    );
    m.assigneeResolver.resolve.mockResolvedValue({
      kind: 'resolved',
      userId: 'user-7',
    });
    m.prisma.person.findFirst.mockResolvedValue({ userId: 'user-setter' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ suggestedAssigneeId: 'user-7' }),
      }),
    );
    expect(m.probe.suggest).toHaveBeenCalledTimes(1);
    expect(m.probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.due_date_missing',
        emittedByService: 'specialist-3-15-tasks',
        recipientCandidates: ['user-setter'],
      }),
    );
  });

  it('(t) нет ни исполнителя, ни срока → шлём ТОЛЬКО assignee-probe (одно за раз)', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(llmResult(taskJson({ dueHint: '' })));
    m.assigneeResolver.resolve.mockResolvedValue({ kind: 'not_found' });
    m.prisma.membership.findFirst.mockResolvedValue({ userId: 'owner-1' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.probe.suggest).toHaveBeenCalledTimes(1);
    expect(m.probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'task.assignee_unresolved' }),
    );
    expect(m.probe.suggest).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'task.due_date_missing' }),
    );
  });

  it('(u) срок ЕСТЬ и исполнитель есть → probe НЕ шлём', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock('chatbox'));
    m.llm.call.mockResolvedValueOnce(
      llmResult(taskJson({ dueHint: '2026-07-01' })),
    );
    m.assigneeResolver.resolve.mockResolvedValue({
      kind: 'resolved',
      userId: 'user-7',
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(m.probe.suggest).not.toHaveBeenCalled();
  });
});

describe('Specialist315TasksService.runClarifySweep', () => {
  let svc: Specialist315TasksService;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('(v) stale pending intake без срока → due-probe постановщику', async () => {
    m.prisma.org.findMany.mockResolvedValue([{ id: TENANT }]);
    m.prisma.intakeIssue.findMany.mockResolvedValue([
      {
        id: 'intake-stale',
        tenantId: TENANT,
        extractedTitle: 'Подготовить смету',
        extractedDescription: 'подготовь смету',
        suggestedAssigneeId: 'user-7',
        suggestedDueDate: null,
        sourceBlockIds: [BLOCK_ID],
      },
    ]);
    m.prisma.ideaBlock.findUnique.mockResolvedValue(
      makeBlock('chatbox', {
        evidence: [
          {
            quote: 'подготовь смету',
            sourceType: 'chatbox',
            authorPersonId: 'p-setter',
          },
        ],
      }),
    );
    m.prisma.person.findFirst.mockResolvedValue({ userId: 'user-setter' });

    const res = await svc.runClarifySweep(new Date('2026-06-29T10:00:00.000Z'));

    expect(m.probe.suggest).toHaveBeenCalledTimes(1);
    expect(m.probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.due_date_missing',
        emittedByService: 'specialist-3-15-tasks-sweep',
        recipientCandidates: ['user-setter'],
      }),
    );
    expect(res.probed).toBe(1);
  });

  it('(w) intake с исполнителем И сроком не попадает в выборку → probe НЕ вызван', async () => {
    m.prisma.org.findMany.mockResolvedValue([{ id: TENANT }]);
    m.prisma.intakeIssue.findMany.mockResolvedValue([]);

    const res = await svc.runClarifySweep(new Date('2026-06-29T10:00:00.000Z'));

    expect(m.probe.suggest).not.toHaveBeenCalled();
    expect(res.probed).toBe(0);
  });

  it('(x) enabled=false → ранний выход, probe не вызван', async () => {
    m.cfg.getDynamic.mockImplementation(
      (key: string, _env: string | undefined, def: unknown) =>
        key === 'tracker.taskClarifySweep.enabled' ? false : def,
    );

    const res = await svc.runClarifySweep(new Date('2026-06-29T10:00:00.000Z'));

    expect(m.prisma.org.findMany).not.toHaveBeenCalled();
    expect(m.probe.suggest).not.toHaveBeenCalled();
    expect(res).toEqual({ orgsScanned: 0, probed: 0 });
  });
});
