/**
 * Unit-тесты для `SpecialistsCombinedService`.
 *
 * Логика: LlmRouterService мокаем, проверяем парсинг tool_calls и
 * вызовы persist'ов для каждого типа сущностей. БД мокаем минимально через
 * объект с jest-стилем (vi.fn() / vi.mocked).
 */

import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';


import { SPECIALISTS_COMBINED_TOOL_NAME } from '../prompts/specialists-combined.prompt';

import {
  SpecialistsCombinedParseError,
  SpecialistsCombinedService,
} from './specialists-combined.service';

function makePrismaMock(): any {
  return {
    decision: { create: vi.fn().mockResolvedValue({ id: 'd1' }) },
    idea: { create: vi.fn().mockResolvedValue({ id: 'i1' }) },
    insight: { create: vi.fn().mockResolvedValue({ id: 'ins1' }) },
    experiment: { create: vi.fn().mockResolvedValue({ id: 'e1' }) },
    regulation: { upsert: vi.fn().mockResolvedValue({ id: 'r1' }) },
    person: { findMany: vi.fn().mockResolvedValue([]) },
    personKnowledgeCategoryEmbedding: {
      create: vi.fn().mockResolvedValue({ id: 'pk1' }),
    },
    skillProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'sp1' }),
    },
    skillTrait: { create: vi.fn().mockResolvedValue({ id: 'st1' }) },
    helpfulnessTrait: { create: vi.fn().mockResolvedValue({ id: 'h1' }) },
  };
}

function makeLlmMock(toolInput: unknown) {
  return {
    call: vi.fn().mockResolvedValue({
      text: '',
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 0,
      durationMs: 1234,
      providerUsed: 'deepseek',
      tier: 'primary',
      toolCalls: [{ name: SPECIALISTS_COMBINED_TOOL_NAME, input: toolInput }],
    }),
  };
}

function makeMetricsMock() {
  return {
    incCoreSpecialistCards: vi.fn(),
    incCoreSpecialistLlmTokens: vi.fn(),
  };
}

const VALID_8_EMPTY = {
  decisions: [],
  ideas: [],
  insights: [],
  experiments: [],
  regulations: [],
  knowledge_categories: [],
  skill_traits: [],
  helpfulness_traits: [],
};

function argsTemplate() {
  return {
    tenantId: 'org-1',
    meetingId: 'm-1',
    meetingTitle: 'Demo',
    blocks: [
      {
        id: 'blk_1',
        name: 'Решение',
        criticalQuestion: 'Что?',
        trustedAnswer: 'Так.',
        signalType: 'decision',
        personNames: ['Иван'],
        evidence: { quote: 'q', speaker: 'Иван' },
      },
    ],
  };
}

describe('SpecialistsCombinedService.extractAll', () => {
  it('возвращает empty-result для пустого blocks без LLM-вызова', async () => {
    const prisma = makePrismaMock();
    const llm = makeLlmMock(VALID_8_EMPTY);
    const metrics = makeMetricsMock();
    const svc = new SpecialistsCombinedService(prisma as any, llm as any, metrics as any);

    const result = await svc.extractAll({
      tenantId: 'org-1',
      meetingId: 'm-1',
      meetingTitle: 'Empty',
      blocks: [],
    });

    expect(llm.call).not.toHaveBeenCalled();
    expect(result.created.decisions).toBe(0);
    expect(result.created.ideas).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.emptySections).toContain('decisions');
  });

  it('делает ОДИН LLM-вызов и persist для всех 8 типов', async () => {
    const prisma = makePrismaMock();
    prisma.person.findMany.mockResolvedValue([
      { id: 'p1', name: 'Иван', profileBuildVersion: 0, email: 'ivan@ex.com', userId: 'u1' },
    ]);

    const toolOutput = {
      decisions: [
        {
          sourceBlockId: 'blk_1',
          statement: 'Решили X',
          rationale: 'потому что',
          alternatives: ['Y'],
          status: 'approved',
          confidence: 0.9,
        },
      ],
      ideas: [
        {
          sourceBlockId: 'blk_1',
          kind: 'internal',
          statement: 'Идея',
          confidence: 0.7,
        },
      ],
      insights: [
        {
          sourceBlockId: 'blk_1',
          kind: 'risk',
          statement: 'Риск Z',
          severity: 'high',
          causeCategory: 'process_gap',
          mitigationSuggestion: 'делать X',
          confidence: 0.8,
        },
      ],
      experiments: [
        {
          sourceBlockId: 'blk_1',
          name: 'A/B test',
          hypothesisText: 'если X, то Y',
          status: 'running',
          lessons: [{ text: 'good', type: 'what_worked' }],
          confidence: 0.6,
        },
      ],
      regulations: [
        {
          sourceBlockId: 'blk_1',
          kind: 'regulation',
          name: 'Reg-1',
          statement: 'Должно быть...',
          confidence: 0.85,
        },
      ],
      knowledge_categories: [
        {
          personName: 'Иван',
          category: 'BI-аналитика',
          confidence: 'medium',
          sampleStatements: ['s1'],
          sourceBlockIds: ['blk_1'],
        },
      ],
      skill_traits: [
        {
          personName: 'Иван',
          category: 'оценка сроков',
          statement: 'Похоже, склонен...',
          confidence: 'low',
          sourceBlockIds: ['blk_1'],
        },
      ],
      helpfulness_traits: [
        {
          sourceBlockId: 'blk_1',
          traitType: 'mentoring',
          helperUserHint: 'Иван',
          topicHint: 'BI',
          intensity: 0.7,
          evidenceQuote: 'объяснил',
          confidence: 0.8,
        },
      ],
    };

    const llm = makeLlmMock(toolOutput);
    const metrics = makeMetricsMock();
    const svc = new SpecialistsCombinedService(prisma as any, llm as any, metrics as any);

    const result = await svc.extractAll({ ...argsTemplate() });

    expect(llm.call).toHaveBeenCalledTimes(1);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1);
    expect(prisma.idea.create).toHaveBeenCalledTimes(1);
    expect(prisma.insight.create).toHaveBeenCalledTimes(1);
    expect(prisma.experiment.create).toHaveBeenCalledTimes(1);
    expect(prisma.regulation.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.personKnowledgeCategoryEmbedding.create).toHaveBeenCalledTimes(1);
    expect(prisma.skillProfile.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.skillProfile.create).toHaveBeenCalledTimes(1);
    expect(prisma.skillTrait.create).toHaveBeenCalledTimes(1);
    expect(prisma.helpfulnessTrait.create).toHaveBeenCalledTimes(1);

    expect(result.created).toEqual({
      decisions: 1,
      ideas: 1,
      insights: 1,
      experiments: 1,
      regulations: 1,
      instructions: 0,
      knowledgeCategories: 1,
      skillTraits: 1,
      helpfulnessTraits: 1,
    });
    expect(result.errors).toEqual([]);
  });

  it('бросает SpecialistsCombinedParseError, если LLM не вернул tool_calls и text пустой', async () => {
    const prisma = makePrismaMock();
    const llm = {
      call: vi.fn().mockResolvedValue({
        text: '',
        modelUsed: 'deepseek:deepseek-v4-pro',
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        durationMs: 1,
        toolCalls: [],
      }),
    };
    const svc = new SpecialistsCombinedService(prisma as any, llm as any, makeMetricsMock() as any);

    await expect(svc.extractAll({ ...argsTemplate() })).rejects.toBeInstanceOf(
      SpecialistsCombinedParseError,
    );
  });

  it('бросает SpecialistsCombinedParseError на невалидном JSON в text-fallback', async () => {
    const prisma = makePrismaMock();
    const llm = {
      call: vi.fn().mockResolvedValue({
        text: 'это не JSON {{{',
        modelUsed: 'deepseek:deepseek-v4-pro',
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        durationMs: 1,
        toolCalls: [],
      }),
    };
    const svc = new SpecialistsCombinedService(prisma as any, llm as any, makeMetricsMock() as any);

    await expect(svc.extractAll({ ...argsTemplate() })).rejects.toBeInstanceOf(
      SpecialistsCombinedParseError,
    );
  });

  it('пропускает сущности с sourceBlockId, которых нет в наборе блоков (защита от галлюцинаций)', async () => {
    const prisma = makePrismaMock();
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [
        {
          sourceBlockId: 'blk_NONEXISTENT',
          statement: 'Фантом',
          confidence: 0.9,
        },
      ],
    });
    const svc = new SpecialistsCombinedService(prisma as any, llm as any, makeMetricsMock() as any);

    const result = await svc.extractAll({ ...argsTemplate() });
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(result.created.decisions).toBe(0);
  });

  it('clamp confidence в [0..1] перед записью в БД', async () => {
    const prisma = makePrismaMock();
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [
        {
          sourceBlockId: 'blk_1',
          statement: 'X',
          confidence: 1.7,
        },
      ],
    });
    const svc = new SpecialistsCombinedService(prisma as any, llm as any, makeMetricsMock() as any);

    await svc.extractAll({ ...argsTemplate() });

    expect(prisma.decision.create).toHaveBeenCalledTimes(1);
    const callArg = prisma.decision.create.mock.calls[0][0];
    // Prisma.Decimal — сравним строковое представление, чтобы не зависеть от
    // внутреннего формата.
    expect(callArg.data.confidence).toBeInstanceOf(Prisma.Decimal);
    expect(callArg.data.confidence.toString()).toBe('1');
  });
});
