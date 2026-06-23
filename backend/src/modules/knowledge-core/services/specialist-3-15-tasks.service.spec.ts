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
    ideaBlock: { findUnique: ReturnType<typeof vi.fn> };
    intakeIssue: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    membership: { findFirst: ReturnType<typeof vi.fn> };
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
    tracker: { assigneeClarifyEnabled: boolean; assigneeProbePriorityHint: number };
    aiFeatures: { promptInjectionGuardEnabled: boolean };
  };
  autoTriageQueue: { enqueue: ReturnType<typeof vi.fn> };
  probe: { suggest: ReturnType<typeof vi.fn> };
}

function buildService(): { svc: Specialist315TasksService; m: Mocks } {
  const m: Mocks = {
    prisma: {
      ideaBlock: { findUnique: vi.fn() },
      intakeIssue: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'intake-new' }),
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'owner-1' }),
      },
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
          (_key: string, _env: string | undefined, def: unknown) => def,
        ),
      pendingActions: { intakeTtlDays: 14 },
      tracker: { assigneeClarifyEnabled: true, assigneeProbePriorityHint: 0.5 },
      aiFeatures: { promptInjectionGuardEnabled: true },
    },
    autoTriageQueue: { enqueue: vi.fn().mockResolvedValue(undefined) },
    probe: { suggest: vi.fn().mockResolvedValue({ ok: true, probeEventId: 'p1' }) },
  };

  const svc = new Specialist315TasksService(

    m.prisma as any,

    m.llm as any,

    m.metrics as any,

    m.logs as any,

    m.assigneeResolver as any,

    m.cfg as any,

    m.autoTriageQueue as any,

    m.probe as any,
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
});
