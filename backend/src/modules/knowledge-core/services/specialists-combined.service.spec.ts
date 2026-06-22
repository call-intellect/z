import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { SPECIALISTS_COMBINED_TOOL_NAME } from '../prompts/specialists-combined.prompt';

import {
  SpecialistsCombinedParseError,
  SpecialistsCombinedService,
} from './specialists-combined.service';

function makePrismaMock(): any {
  return {
    // Б50 — findFirst для source-block дедупа (null = дубля нет → create).
    // F1 — findUnique/upsert по sourceIdeaBlockId (идемпотентность combined).
    decision: {
      create: vi.fn().mockResolvedValue({ id: 'd1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'd1' }),
    },
    idea: {
      create: vi.fn().mockResolvedValue({ id: 'i1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    insight: {
      create: vi.fn().mockResolvedValue({ id: 'ins1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    experiment: {
      create: vi.fn().mockResolvedValue({ id: 'e1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // Б57 — findUnique для чтения существующего sourceBlockIds перед union.
    regulation: {
      upsert: vi.fn().mockResolvedValue({ id: 'r1' }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    instruction: {
      upsert: vi.fn().mockResolvedValue({ id: 'instr1' }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    person: { findMany: vi.fn().mockResolvedValue([]) },
    personKnowledgeCategoryEmbedding: {
      create: vi.fn().mockResolvedValue({ id: 'pk1' }),
    },
    skillProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'sp1' }),
    },
    skillTrait: { create: vi.fn().mockResolvedValue({ id: 'st1' }) },
    helpfulnessTrait: {
      create: vi.fn().mockResolvedValue({ id: 'h1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  };
}

function makeCurationMock() {
  return { triage: vi.fn().mockResolvedValue({ status: 'provisional' }) };
}

function makeEmbedderMock() {
  return { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
}

function makeEventsMock() {
  return { emit: vi.fn() };
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
    incCoreSpecialistSkipped: vi.fn(),
    incCoreSpecialistExtractionFailure: vi.fn(),
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
    expect(prisma.decision.upsert).toHaveBeenCalledTimes(1);
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

    expect(prisma.decision.upsert).toHaveBeenCalledTimes(1);
    const callArg = prisma.decision.upsert.mock.calls[0][0];
    expect(callArg.create.confidence).toBeInstanceOf(Prisma.Decimal);
    expect(callArg.create.confidence.toString()).toBe('1');
  });

  // ─────────────────── Б50 (K4): source-block дедуп ───────────────────

  it('Б50: повтор combined по тому же блоку (уже есть Decision по sourceBlockId) → дедуп, create не вызывается', async () => {
    const prisma = makePrismaMock();
    // findFirst находит уже существующее решение по этому блоку → дубль.
    prisma.decision.findFirst.mockResolvedValue({ id: 'd-existing' });
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [
        { sourceBlockId: 'blk_1', statement: 'Решили X', confidence: 0.9 },
      ],
    });
    const metrics = makeMetricsMock();
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      metrics as any,
    );

    const result = await svc.extractAll({ ...argsTemplate() });

    expect(prisma.decision.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(result.created.decisions).toBe(0);
    expect(metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith({
      specialist: 'decision',
      reason: 'source_block_dedup',
    });
  });

  it('P2002 sourceIdeaBlockId при upsert decision → дедуп, не ошибка, метрика db_conflict', async () => {
    const prisma = makePrismaMock();
    prisma.decision.findFirst.mockResolvedValue(null);
    prisma.decision.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['sourceIdeaBlockId'] },
      }),
    );
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [{ sourceBlockId: 'blk_1', statement: 'Решили X', confidence: 0.9 }],
    });
    const metrics = makeMetricsMock();
    const svc = new SpecialistsCombinedService(prisma as any, llm as any, metrics as any);

    const result = await svc.extractAll({ ...argsTemplate() });

    expect(prisma.decision.upsert).toHaveBeenCalledTimes(1);
    expect(result.created.decisions).toBe(0);
    expect(result.errors.some((e) => e.includes('decision[blk_1]'))).toBe(false);
    expect(metrics.incCoreSpecialistExtractionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'decision', reason: 'db_conflict' }),
    );
  });

  // ─────────────────── Б57 (K4): провенанс через set:union ───────────────────

  it('Б57: повтор regulation с тем же sourceBlockId → set:union без дубля в массиве', async () => {
    const prisma = makePrismaMock();
    // У существующего регламента уже есть этот sourceBlockId.
    prisma.regulation.findUnique.mockResolvedValue({
      sourceBlockIds: ['blk_1'],
    });
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      regulations: [
        {
          sourceBlockId: 'blk_1',
          kind: 'regulation',
          name: 'Reg-1',
          statement: 'Должно быть...',
          confidence: 0.85,
          isOrgNorm: true,
        },
      ],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
    );

    await svc.extractAll({ ...argsTemplate() });

    expect(prisma.regulation.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = prisma.regulation.upsert.mock.calls[0][0];
    // update-ветка использует set:union, а НЕ push → без дубля.
    expect(upsertArg.update.sourceBlockIds).toEqual({ set: ['blk_1'] });
    expect(upsertArg.update.sourceBlockIds.set).toHaveLength(1);
    expect(upsertArg.update.sourceBlockIds).not.toHaveProperty('push');
  });

  it('Б57: новый sourceBlockId у существующего regulation → union добавляет, старый сохранён', async () => {
    const prisma = makePrismaMock();
    prisma.regulation.findUnique.mockResolvedValue({
      sourceBlockIds: ['blk_old'],
    });
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      regulations: [
        {
          sourceBlockId: 'blk_1',
          kind: 'regulation',
          name: 'Reg-1',
          statement: 'Должно быть...',
          confidence: 0.85,
          isOrgNorm: true,
        },
      ],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
    );

    await svc.extractAll({ ...argsTemplate() });

    const upsertArg = prisma.regulation.upsert.mock.calls[0][0];
    expect(upsertArg.update.sourceBlockIds.set).toEqual(
      expect.arrayContaining(['blk_old', 'blk_1']),
    );
    expect(upsertArg.update.sourceBlockIds.set).toHaveLength(2);
  });

  it('Б57: повтор instruction с тем же sourceBlockId → set:union без дубля', async () => {
    const prisma = makePrismaMock();
    prisma.instruction.findUnique.mockResolvedValue({
      sourceBlockIds: ['blk_1'],
    });
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      regulations: [
        {
          sourceBlockId: 'blk_1',
          kind: 'instruction',
          name: 'Instr-1',
          statement: 'Шаг 1...',
          confidence: 0.8,
          roles: ['Менеджер'],
        },
      ],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
    );

    await svc.extractAll({ ...argsTemplate() });

    expect(prisma.instruction.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = prisma.instruction.upsert.mock.calls[0][0];
    expect(upsertArg.update.sourceBlockIds).toEqual({ set: ['blk_1'] });
    expect(upsertArg.update.sourceBlockIds).not.toHaveProperty('push');
  });

  // ─────────────────── F1 (идемпотентность decision через upsert) ───────────────────

  it('F1: первый прогон combined по блоку → upsert.create-ветка, decision материализован', async () => {
    const prisma = makePrismaMock();
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [{ sourceBlockId: 'blk_1', statement: 'Решили X', confidence: 0.9 }],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
    );

    const result = await svc.extractAll({ ...argsTemplate() });

    expect(prisma.decision.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = prisma.decision.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ sourceIdeaBlockId: 'blk_1' });
    expect(upsertArg.create.sourceIdeaBlockId).toBe('blk_1');
    expect(upsertArg.update.sourceBlockIds).toEqual({ set: ['blk_1'] });
    expect(result.created.decisions).toBe(1);
  });

  it('F1: повтор того же блока (decision уже есть по sourceIdeaBlockId) → upsert.update объединяет sourceBlockIds, не падает, не дубль', async () => {
    const prisma = makePrismaMock();
    // findFirst по sourceBlockIds:{has} НЕ находит дубль (гонка двух писателей —
    // оба прошли guard), но по sourceIdeaBlockId уже есть запись с blk_old.
    prisma.decision.findFirst.mockResolvedValue(null);
    prisma.decision.findUnique.mockResolvedValue({
      id: 'd-existing',
      sourceBlockIds: ['blk_old'],
    });
    prisma.decision.upsert.mockResolvedValue({ id: 'd-existing' });
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [{ sourceBlockId: 'blk_1', statement: 'Решили X', confidence: 0.9 }],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
    );

    const result = await svc.extractAll({ ...argsTemplate() });

    expect(prisma.decision.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = prisma.decision.upsert.mock.calls[0][0];
    expect(upsertArg.update.sourceBlockIds.set).toEqual(
      expect.arrayContaining(['blk_old', 'blk_1']),
    );
    expect(upsertArg.update.sourceBlockIds.set).toHaveLength(2);
    // existing!==null → НЕ инкрементим счётчик новых.
    expect(result.created.decisions).toBe(0);
    expect(result.errors).toEqual([]);
  });

  // ─────────────────── F3 (побочные эффекты как у полного специалиста) ───────────────────

  it('F3 decision: combined создаёт decision → curation.triage(decision) + embedding записаны', async () => {
    const prisma = makePrismaMock();
    const curation = makeCurationMock();
    const embedder = makeEmbedderMock();
    const events = makeEventsMock();
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [
        { sourceBlockId: 'blk_1', statement: 'Решили X', rationale: 'причина', confidence: 0.9 },
      ],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
      undefined,
      curation as any,
      embedder as any,
      events as any,
    );

    await svc.extractAll({ ...argsTemplate() });

    expect(curation.triage).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'decision',
        resourceId: 'd1',
        proposedPayload: expect.objectContaining({ statement: 'Решили X' }),
      }),
    );
    expect(embedder.embedQuery).toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "decisions"'),
      expect.any(String),
      'd1',
    );
  });

  it('F3 idea: combined создаёт idea → weight>0 записан, curation.triage(idea) + idea.created event', async () => {
    const prisma = makePrismaMock();
    prisma.idea.create.mockResolvedValue({ id: 'i1' });
    const curation = makeCurationMock();
    const embedder = makeEmbedderMock();
    const events = makeEventsMock();
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      ideas: [
        { sourceBlockId: 'blk_1', kind: 'internal', statement: 'Идея Z', confidence: 0.7 },
      ],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
      undefined,
      curation as any,
      embedder as any,
      events as any,
    );

    await svc.extractAll({ ...argsTemplate() });

    expect(prisma.idea.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.idea.create.mock.calls[0][0];
    expect(createArg.data.weight).toBeInstanceOf(Prisma.Decimal);
    expect(Number(createArg.data.weight.toString())).toBeGreaterThan(0);
    expect(createArg.data.status).toBe('captured');
    expect(curation.triage).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'idea', resourceId: 'i1' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'idea.created',
      expect.objectContaining({ ideaId: 'i1' }),
    );
  });

  it('F3 best-effort: triage бросает → decision всё равно персистится, combined не падает', async () => {
    const prisma = makePrismaMock();
    const curation = makeCurationMock();
    curation.triage.mockRejectedValue(new Error('triage down'));
    const embedder = makeEmbedderMock();
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      decisions: [{ sourceBlockId: 'blk_1', statement: 'Решили X', confidence: 0.9 }],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
      undefined,
      curation as any,
      embedder as any,
      makeEventsMock() as any,
    );

    const result = await svc.extractAll({ ...argsTemplate() });

    expect(prisma.decision.upsert).toHaveBeenCalledTimes(1);
    expect(result.created.decisions).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('F3 best-effort: idea triage бросает → idea персистится, combined не падает', async () => {
    const prisma = makePrismaMock();
    prisma.idea.create.mockResolvedValue({ id: 'i1' });
    const curation = makeCurationMock();
    curation.triage.mockRejectedValue(new Error('triage down'));
    const llm = makeLlmMock({
      ...VALID_8_EMPTY,
      ideas: [
        { sourceBlockId: 'blk_1', kind: 'internal', statement: 'Идея Z', confidence: 0.7 },
      ],
    });
    const svc = new SpecialistsCombinedService(
      prisma as any,
      llm as any,
      makeMetricsMock() as any,
      undefined,
      curation as any,
      makeEmbedderMock() as any,
      makeEventsMock() as any,
    );

    const result = await svc.extractAll({ ...argsTemplate() });

    expect(prisma.idea.create).toHaveBeenCalledTimes(1);
    expect(result.created.ideas).toBe(1);
    expect(result.errors).toEqual([]);
  });
});
