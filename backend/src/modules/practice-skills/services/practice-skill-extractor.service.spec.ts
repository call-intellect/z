import type { PracticeSkill } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';

import { PracticeSkillExtractorService } from './practice-skill-extractor.service';

const TENANT = 'org-1';
const CONCEPT = 'concept-1';
const PERSON = 'person-1';
const PROFILE = 'profile-1';

interface MockPrisma {
  skillTraitConcept: { findUnique: ReturnType<typeof vi.fn> };
  skillTrait: { findMany: ReturnType<typeof vi.fn> };
  skillProfile: { findMany: ReturnType<typeof vi.fn> };
  ideaBlock: { findMany: ReturnType<typeof vi.fn> };
  practiceSkill: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
}

function makePrisma(args?: {
  concept?: {
    id: string;
    tenantId: string;
    canonicalName: string;
    status: 'active' | 'archived' | 'merged_into';
    traitCount: number;
  } | null;
  traits?: Array<{
    id: string;
    statement: string;
    sourceBlockIds: string[];
    profileId: string;
  }>;
  blocks?: Array<{ id: string; name: string; trustedAnswer: string | null }>;
  knnRows?: Array<{ id: string; dist: number }>;
  existingSkill?: PracticeSkill | null;
}): MockPrisma {
  return {
    skillTraitConcept: {
      findUnique: vi.fn().mockResolvedValue(args?.concept ?? null),
    },
    skillTrait: {
      findMany: vi.fn().mockResolvedValue(args?.traits ?? []),
    },
    skillProfile: {
      findMany: vi.fn().mockResolvedValue([{ id: PROFILE, personId: PERSON, tenantId: TENANT }]),
    },
    ideaBlock: {
      findMany: vi.fn().mockResolvedValue(args?.blocks ?? []),
    },
    practiceSkill: {
      findUnique: vi.fn().mockResolvedValue(args?.existingSkill ?? null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: 'skill-new',
        tenantId: data.tenantId,
        scope: data.scope,
        scopeRefId: data.scopeRefId,
        trigger: data.trigger,
        steps: data.steps,
        examples: data.examples,
        redFlags: data.redFlags,
        status: data.status,
        trafficShare: data.trafficShare,
        shadowMetrics: null,
        successRate: null,
        lastUsed: null,
        derivedFromConceptIds: data.derivedFromConceptIds,
        derivedFromTraitIds: data.derivedFromTraitIds,
        derivedFromEpisodeCount: data.derivedFromEpisodeCount,
        pinned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        promotedAt: null,
        archivedAt: null,
        archivedReason: null,
        version: 1,
      })),
      update: vi.fn().mockImplementation(async ({ where, data }) => ({
        ...(args?.existingSkill as PracticeSkill),
        id: where.id,
        ...data,
        updatedAt: new Date(),
      })),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue(args?.knnRows ?? []),
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCfg(): TypedConfigService {
  return {
    practiceSkills: {
      enabled: false,
      minTraitsForExtract: 5,
      shadowTrafficShare: 0.1,
      knnRetrievalThreshold: 0.78,
      knnDedupThreshold: 0.85,
      evalMinRuns: 30,
      evalPromoteDelta: 0.05,
      evalArchiveDelta: 0.05,
    },
  } as unknown as TypedConfigService;
}

function makeLlm(text: string): LlmRouterService {
  return {
    call: vi.fn().mockResolvedValue({
      text,
      modelUsed: 'deepseek-v4-pro',
      inputTokens: 100,
      outputTokens: 200,
      tier: 'primary',
    }),
  } as unknown as LlmRouterService;
}

function makeEmbedder(vec: number[] | null): KnowledgeEmbeddingService {
  return {
    embedQuery: vi.fn().mockResolvedValue(vec),
  } as unknown as KnowledgeEmbeddingService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incPracticeSkillsExtracted: vi.fn(),
  } as unknown as BusinessMetricsService;
}

describe('PracticeSkillExtractorService', () => {
  let llmMock: LlmRouterService;
  let metrics: BusinessMetricsService;
  let embedder: KnowledgeEmbeddingService;

  beforeEach(() => {
    llmMock = makeLlm('{}');
    metrics = makeMetrics();
    embedder = makeEmbedder(new Array(1536).fill(0.01));
  });

  it('1) concept с traitCount < min → пустой результат, LLM не вызывался', async () => {
    const prisma = makePrisma({
      concept: {
        id: CONCEPT,
        tenantId: TENANT,
        canonicalName: 'Aккуратность с оценками',
        status: 'active',
        traitCount: 2,
      },
    });
    const svc = new PracticeSkillExtractorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      llmMock,
      embedder,
      metrics,
    );
    const out = await svc.extractForConcept({
      tenantId: TENANT,
      conceptId: CONCEPT,
    });
    expect(out).toEqual([]);
    expect(llmMock.call).not.toHaveBeenCalled();
    expect(prisma.skillTrait.findMany).not.toHaveBeenCalled();
  });

  it('2) LLM вернул skill=null → ничего не создаётся', async () => {
    const validBlock = {
      id: 'block-1',
      name: 'Подход к оценке сроков',
      trustedAnswer: 'Я всегда стараюсь сначала уточнить вопросы.',
    };
    const prisma = makePrisma({
      concept: {
        id: CONCEPT,
        tenantId: TENANT,
        canonicalName: 'Оценка сроков',
        status: 'active',
        traitCount: 10,
      },
      traits: [
        { id: 'trait-1', statement: 't1', sourceBlockIds: [validBlock.id], profileId: PROFILE },
        { id: 'trait-2', statement: 't2', sourceBlockIds: [validBlock.id], profileId: PROFILE },
      ],
      blocks: [validBlock],
    });
    llmMock = makeLlm(JSON.stringify({ skill: null, confidence: 0.3 }));
    const svc = new PracticeSkillExtractorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      llmMock,
      embedder,
      metrics,
    );
    const out = await svc.extractForConcept({
      tenantId: TENANT,
      conceptId: CONCEPT,
    });
    expect(out).toEqual([]);
    expect(llmMock.call).toHaveBeenCalledTimes(1);
    expect(prisma.practiceSkill.create).not.toHaveBeenCalled();
  });

  it('3) валидный skill с confidence ≥ 0.7 → create + embedding upsert + metric', async () => {
    const block = {
      id: 'block-1',
      name: 'b',
      trustedAnswer: 'когда клиент возражает на цену…',
    };
    const prisma = makePrisma({
      concept: {
        id: CONCEPT,
        tenantId: TENANT,
        canonicalName: 'Работа с возражениями',
        status: 'active',
        traitCount: 10,
      },
      traits: [{ id: 'trait-1', statement: 't1', sourceBlockIds: [block.id], profileId: PROFILE }],
      blocks: [block],
    });
    llmMock = makeLlm(
      JSON.stringify({
        skill: {
          trigger: 'когда клиент возражает на цену enterprise',
          steps: [
            { order: 1, action: 'Уточнить boundary условий' },
            { order: 2, action: 'Предложить split-payment' },
          ],
          redFlags: ['Не давить'],
          reasoning: 'Так делает носитель в 3 блоках',
        },
        confidence: 0.92,
      }),
    );
    const svc = new PracticeSkillExtractorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      llmMock,
      embedder,
      metrics,
    );
    const out = await svc.extractForConcept({
      tenantId: TENANT,
      conceptId: CONCEPT,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.scope).toBe('person');
    expect(out[0]!.scopeRefId).toBe(PERSON);
    expect(prisma.practiceSkill.create).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "practice_skills" SET "triggerEmbedding"'),
      expect.any(String),
      'skill-new',
    );
    expect(metrics.incPracticeSkillsExtracted).toHaveBeenCalledWith({
      scope: 'person',
    });
  });

  it('4) KNN dedup нашёл existing → merge (без create), version++', async () => {
    const block = { id: 'b1', name: 'b', trustedAnswer: 'когда…' };
    const existingSkill: PracticeSkill = {
      id: 'skill-existing',
      tenantId: TENANT,
      scope: 'person',
      scopeRefId: PERSON,
      trigger: 'когда X',
      steps: [] as unknown as object,
      examples: [] as unknown as object,
      redFlags: [] as unknown as object,
      status: 'shadow',
      trafficShare: 0.1,
      shadowMetrics: null,
      successRate: null,
      lastUsed: null,
      derivedFromConceptIds: ['concept-old'],
      derivedFromTraitIds: ['trait-old'],
      derivedFromEpisodeCount: 5,
      pinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      promotedAt: null,
      archivedAt: null,
      archivedReason: null,
      version: 1,
    } as unknown as PracticeSkill;
    const prisma = makePrisma({
      concept: {
        id: CONCEPT,
        tenantId: TENANT,
        canonicalName: 'Тест',
        status: 'active',
        traitCount: 10,
      },
      traits: [{ id: 'trait-1', statement: 't1', sourceBlockIds: [block.id], profileId: PROFILE }],
      blocks: [block],
      knnRows: [{ id: 'skill-existing', dist: 0.05 }],
      existingSkill,
    });
    llmMock = makeLlm(
      JSON.stringify({
        skill: {
          trigger: 'когда клиент возражает на цену',
          steps: [
            { order: 1, action: 'шаг 1' },
            { order: 2, action: 'шаг 2' },
          ],
          redFlags: [],
          reasoning: 'why',
        },
        confidence: 0.9,
      }),
    );
    const svc = new PracticeSkillExtractorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      llmMock,
      embedder,
      metrics,
    );
    const out = await svc.extractForConcept({
      tenantId: TENANT,
      conceptId: CONCEPT,
    });
    expect(out).toHaveLength(1);
    expect(prisma.practiceSkill.create).not.toHaveBeenCalled();
    expect(prisma.practiceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'skill-existing' },
        data: expect.objectContaining({
          derivedFromConceptIds: expect.arrayContaining(['concept-old', CONCEPT]),
          derivedFromTraitIds: expect.arrayContaining(['trait-old', 'trait-1']),
          version: 2,
        }),
      }),
    );
  });

  it('5) confidence < 0.7 → не создаётся', async () => {
    const block = { id: 'b1', name: 'b', trustedAnswer: 'когда…' };
    const prisma = makePrisma({
      concept: {
        id: CONCEPT,
        tenantId: TENANT,
        canonicalName: 'X',
        status: 'active',
        traitCount: 10,
      },
      traits: [{ id: 't1', statement: 's', sourceBlockIds: [block.id], profileId: PROFILE }],
      blocks: [block],
    });
    llmMock = makeLlm(
      JSON.stringify({
        skill: {
          trigger: 'когда что-то происходит',
          steps: [
            { order: 1, action: 'действие 1' },
            { order: 2, action: 'действие 2' },
          ],
          redFlags: [],
          reasoning: 'слабая уверенность',
        },
        confidence: 0.5,
      }),
    );
    const svc = new PracticeSkillExtractorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      llmMock,
      embedder,
      metrics,
    );
    const out = await svc.extractForConcept({
      tenantId: TENANT,
      conceptId: CONCEPT,
    });
    expect(out).toEqual([]);
    expect(prisma.practiceSkill.create).not.toHaveBeenCalled();
  });
});
