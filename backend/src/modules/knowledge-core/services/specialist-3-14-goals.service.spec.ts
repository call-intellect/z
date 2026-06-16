import { describe, expect, it, vi, beforeEach } from 'vitest';

import { Specialist314GoalsService } from './specialist-3-14-goals.service';

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

function makeBlock(overrides: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    tenantId: TENANT,
    name: 'План на квартал',
    criticalQuestion: 'Какая цель?',
    trustedAnswer: '100 встреч за квартал',
    signalType: 'commitment',
    tags: [],
    dataClass: 'internal',
    evidence: [{ quote: 'нужно 100 встреч за квартал' }],
    ...overrides,
  };
}

interface Mocks {
  prisma: {
    ideaBlock: { findUnique: ReturnType<typeof vi.fn> };
    goal: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    goalKeyResult: { create: ReturnType<typeof vi.fn> };
    membership: { findFirst: ReturnType<typeof vi.fn> };
  };
  llm: { call: ReturnType<typeof vi.fn> };
  embedder: { embedQuery: ReturnType<typeof vi.fn> };
  metrics: {
    incCoreSpecialistCards: ReturnType<typeof vi.fn>;
    observeCoreSpecialistPipelineDuration: ReturnType<typeof vi.fn>;
    incCoreSpecialistLlmTokens: ReturnType<typeof vi.fn>;
    incCoreSpecialistExtractionFailure: ReturnType<typeof vi.fn>;
  };
  logs: { write: ReturnType<typeof vi.fn> };
}

function buildService(): { svc: Specialist314GoalsService; m: Mocks } {
  const m: Mocks = {
    prisma: {
      ideaBlock: { findUnique: vi.fn() },
      goal: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'goal-new' }),
        update: vi.fn().mockResolvedValue({ id: 'goal-existing' }),
      },
      goalKeyResult: { create: vi.fn().mockResolvedValue({ id: 'kr-1' }) },
      membership: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'owner-1' }),
      },
    },
    llm: { call: vi.fn() },
    embedder: { embedQuery: vi.fn().mockResolvedValue(null) },
    metrics: {
      incCoreSpecialistCards: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
      incCoreSpecialistExtractionFailure: vi.fn(),
    },
    logs: { write: vi.fn() },
  };

  const svc = new Specialist314GoalsService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.prisma as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.llm as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.embedder as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.metrics as any,
    m.logs as any,
    undefined,
  );
  return { svc, m };
}

describe('Specialist314GoalsService.processBlock', () => {
  let svc: Specialist314GoalsService;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
    m.prisma.ideaBlock.findUnique.mockResolvedValue(makeBlock());
  });

  it('extract → null когда isGoal=false: цель не создаётся', async () => {
    m.llm.call.mockResolvedValueOnce(
      llmResult({
        isGoal: false,
        statement: 'недостаточно сигнала',
        description: null,
        horizon: 'quarterly',
        measurable: null,
        confidence: 0.1,
      }),
    );

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goal.create).not.toHaveBeenCalled();
    expect(m.llm.call).toHaveBeenCalledTimes(1);
  });

  it('extract → null когда confidence < MIN (0.4): цель не создаётся', async () => {
    m.llm.call.mockResolvedValueOnce(
      llmResult({
        isGoal: true,
        statement: 'Стать №1',
        description: null,
        horizon: 'strategic',
        measurable: null,
        confidence: 0.3,
      }),
    );

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goal.create).not.toHaveBeenCalled();
  });

  it('standalone (нет KNN-кандидатов): goal.create без parentGoalId, без LLM-арбитра', async () => {
    m.llm.call.mockResolvedValueOnce(
      llmResult({
        isGoal: true,
        statement: 'Провести 100 встреч за квартал',
        description: 'рост воронки',
        horizon: 'quarterly',
        measurable: null,
        confidence: 0.6,
      }),
    );
    m.prisma.goal.findMany.mockResolvedValue([]);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.llm.call).toHaveBeenCalledTimes(1);
    expect(m.prisma.goal.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentGoalId: null,
          source: 'ai',
          promotionState: 'suggested',
          createdById: 'owner-1',
        }),
      }),
    );
  });

  it('confidence >= 0.8 → promotionState=active (auto-promote)', async () => {
    m.llm.call.mockResolvedValueOnce(
      llmResult({
        isGoal: true,
        statement: 'Вырастить выручку до 10 млн',
        description: null,
        horizon: 'annual',
        measurable: null,
        confidence: 0.9,
      }),
    );
    m.prisma.goal.findMany.mockResolvedValue([]);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ promotionState: 'active' }),
      }),
    );
  });

  it('dedup: verdict=duplicate к suggested-цели → existing промоутится active, новой нет', async () => {
    m.llm.call
      .mockResolvedValueOnce(
        llmResult({
          isGoal: true,
          statement: 'Провести 100 встреч за квартал',
          description: null,
          horizon: 'quarterly',
          measurable: null,
          confidence: 0.6,
        }),
      )
      .mockResolvedValueOnce(
        llmResult({
          verdict: 'duplicate',
          targetId: 'goal-existing',
          parentId: null,
          confidence: 0.9,
          reasoning: 'та же цель',
        }),
      );
    m.prisma.goal.findMany.mockResolvedValue([
      {
        id: 'goal-existing',
        name: 'Провести встречи',
        description: null,
        horizon: 'quarterly',
        promotionState: 'suggested',
      },
    ]);
    m.prisma.goal.findFirst.mockResolvedValue({
      id: 'goal-existing',
      promotionState: 'suggested',
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goal.create).not.toHaveBeenCalled();
    expect(m.prisma.goal.update).toHaveBeenCalledTimes(1);
    expect(m.prisma.goal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'goal-existing' },
        data: { promotionState: 'active' },
      }),
    );
    expect(m.metrics.incCoreSpecialistExtractionFailure).toHaveBeenCalledWith({
      type: 'goal',
      reason: 'dedup',
    });
  });

  it('hierarchy: verdict=child_of → goal.create с parentGoalId', async () => {
    m.llm.call
      .mockResolvedValueOnce(
        llmResult({
          isGoal: true,
          statement: 'Закрыть 5 демо за спринт',
          description: null,
          horizon: 'sprint',
          measurable: null,
          confidence: 0.6,
        }),
      )
      .mockResolvedValueOnce(
        llmResult({
          verdict: 'child_of',
          targetId: null,
          parentId: 'goal-parent',
          confidence: 0.85,
          reasoning: 'спринт-подцель квартальной',
        }),
      );
    m.prisma.goal.findMany.mockResolvedValue([
      {
        id: 'goal-parent',
        name: 'Провести 100 встреч',
        description: null,
        horizon: 'quarterly',
        promotionState: 'active',
      },
    ]);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goal.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.goal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ parentGoalId: 'goal-parent' }),
      }),
    );
  });

  it('cap: >=7 активных целей горизонта → создания нет + метрика focus_cap', async () => {
    m.llm.call.mockResolvedValueOnce(
      llmResult({
        isGoal: true,
        statement: 'Ещё одна квартальная цель',
        description: null,
        horizon: 'quarterly',
        measurable: null,
        confidence: 0.6,
      }),
    );
    m.prisma.goal.findMany.mockResolvedValue([]);
    m.prisma.goal.count.mockResolvedValue(7);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goal.create).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistExtractionFailure).toHaveBeenCalledWith({
      type: 'goal',
      reason: 'focus_cap',
    });
  });

  it('measurable не null → создаётся GoalKeyResult', async () => {
    m.llm.call.mockResolvedValueOnce(
      llmResult({
        isGoal: true,
        statement: 'Провести 100 встреч за квартал',
        description: null,
        horizon: 'quarterly',
        measurable: {
          name: 'Встречи',
          unit: 'встреч',
          startValue: 20,
          targetValue: 100,
        },
        confidence: 0.6,
      }),
    );
    m.prisma.goal.findMany.mockResolvedValue([]);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goalKeyResult.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.goalKeyResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Встречи',
          sourceKind: 'manual',
          source: 'ai',
        }),
      }),
    );
  });

  it('owner Org не найден → цель не создаётся (не падает)', async () => {
    m.llm.call.mockResolvedValueOnce(
      llmResult({
        isGoal: true,
        statement: 'Цель без owner',
        description: null,
        horizon: 'quarterly',
        measurable: null,
        confidence: 0.6,
      }),
    );
    m.prisma.goal.findMany.mockResolvedValue([]);
    m.prisma.membership.findFirst.mockResolvedValue(null);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.goal.create).not.toHaveBeenCalled();
  });
});
