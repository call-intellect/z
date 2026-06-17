import type { PracticeSkill } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';

import { PracticeSkillRetrievalService } from './practice-skill-retrieval.service';

const TENANT = 'org-1';
const PERSON = 'person-1';

function skill(id: string, overrides: Partial<PracticeSkill> = {}): PracticeSkill {
  return {
    id,
    tenantId: TENANT,
    scope: 'person',
    scopeRefId: PERSON,
    trigger: `когда X для ${id}`,
    steps: [{ order: 1, action: 'A' }] as unknown as object,
    examples: [] as unknown as object,
    redFlags: [] as unknown as object,
    status: 'active',
    trafficShare: 1.0,
    shadowMetrics: null,
    successRate: null,
    lastUsed: null,
    derivedFromConceptIds: [],
    derivedFromTraitIds: [],
    derivedFromEpisodeCount: 0,
    pinned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    promotedAt: null,
    archivedAt: null,
    archivedReason: null,
    version: 1,
    ...overrides,
  } as unknown as PracticeSkill;
}

function makeCfg(enabled: boolean): TypedConfigService {
  return {
    practiceSkills: {
      enabled,
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

function makeEmbedder(vec: number[] | null): KnowledgeEmbeddingService {
  return {
    embedQuery: vi.fn().mockResolvedValue(vec),
  } as unknown as KnowledgeEmbeddingService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incPracticeSkillsRetrievalHit: vi.fn(),
    incPracticeSkillsRun: vi.fn(),
  } as unknown as BusinessMetricsService;
}

interface MockPrisma {
  practiceSkill: {
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  skillUsage: {
    createMany: ReturnType<typeof vi.fn>;
  };
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
}

function makePrisma(args?: { knnIds?: string[]; skills?: PracticeSkill[] }): MockPrisma {
  const rows = (args?.knnIds ?? []).map((id) => ({ id, dist: 0.1 }));
  return {
    practiceSkill: {
      findMany: vi.fn().mockResolvedValue(args?.skills ?? []),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    skillUsage: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
  };
}

describe('PracticeSkillRetrievalService', () => {
  it('1) enabled=false → возвращает [] без embed-вызовов', async () => {
    const embedder = makeEmbedder(new Array(1536).fill(0.01));
    const prisma = makePrisma();
    const svc = new PracticeSkillRetrievalService(
      prisma as unknown as PrismaService,
      makeCfg(false),
      embedder,
      makeMetrics(),
    );
    const out = await svc.retrieveForCloneRespond({
      tenantId: TENANT,
      scope: 'person',
      scopeRefId: PERSON,
      question: 'как ты работаешь с клиентами?',
      conversationId: 'conv-1',
    });
    expect(out).toEqual([]);
    expect(embedder.embedQuery).not.toHaveBeenCalled();
  });

  it('2) KNN ничего не нашёл → []', async () => {
    const embedder = makeEmbedder(new Array(1536).fill(0.01));
    const prisma = makePrisma({ knnIds: [], skills: [] });
    const svc = new PracticeSkillRetrievalService(
      prisma as unknown as PrismaService,
      makeCfg(true),
      embedder,
      makeMetrics(),
    );
    const out = await svc.retrieveForCloneRespond({
      tenantId: TENANT,
      scope: 'person',
      scopeRefId: PERSON,
      question: 'как ты работаешь с клиентами?',
      conversationId: 'conv-1',
    });
    expect(out).toEqual([]);
  });

  it('3) active skill → всегда включается', async () => {
    const s = skill('s1', { status: 'active', trafficShare: 0.0 });
    const embedder = makeEmbedder(new Array(1536).fill(0.01));
    const prisma = makePrisma({ knnIds: ['s1'], skills: [s] });
    const metrics = makeMetrics();
    const svc = new PracticeSkillRetrievalService(
      prisma as unknown as PrismaService,
      makeCfg(true),
      embedder,
      metrics,
    );
    const out = await svc.retrieveForCloneRespond({
      tenantId: TENANT,
      scope: 'person',
      scopeRefId: PERSON,
      question: 'вопрос',
      conversationId: 'conv-active',
    });
    expect(out.map((x) => x.id)).toEqual(['s1']);
    expect(metrics.incPracticeSkillsRetrievalHit).toHaveBeenCalledWith({
      scope: 'person',
    });
  });

  it('4) shadow + trafficShare=1.0 → всегда включается', async () => {
    const s = skill('s1', { status: 'shadow', trafficShare: 1.0 });
    const embedder = makeEmbedder(new Array(1536).fill(0.01));
    const prisma = makePrisma({ knnIds: ['s1'], skills: [s] });
    const svc = new PracticeSkillRetrievalService(
      prisma as unknown as PrismaService,
      makeCfg(true),
      embedder,
      makeMetrics(),
    );
    const out = await svc.retrieveForCloneRespond({
      tenantId: TENANT,
      scope: 'person',
      scopeRefId: PERSON,
      question: 'q',
      conversationId: 'c1',
    });
    expect(out.map((x) => x.id)).toEqual(['s1']);
  });

  it('5) shadow + trafficShare=0.0 → исключается', async () => {
    const s = skill('s1', { status: 'shadow', trafficShare: 0.0 });
    const embedder = makeEmbedder(new Array(1536).fill(0.01));
    const prisma = makePrisma({ knnIds: ['s1'], skills: [s] });
    const svc = new PracticeSkillRetrievalService(
      prisma as unknown as PrismaService,
      makeCfg(true),
      embedder,
      makeMetrics(),
    );
    const out = await svc.retrieveForCloneRespond({
      tenantId: TENANT,
      scope: 'person',
      scopeRefId: PERSON,
      question: 'q',
      conversationId: 'c1',
    });
    expect(out).toEqual([]);
  });

  it('6) pinned выходит в начало', async () => {
    const s1 = skill('s1', { status: 'active', pinned: false });
    const s2 = skill('s2', { status: 'active', pinned: true });
    const embedder = makeEmbedder(new Array(1536).fill(0.01));
    const prisma = makePrisma({
      knnIds: ['s1', 's2'],
      skills: [s1, s2],
    });
    const svc = new PracticeSkillRetrievalService(
      prisma as unknown as PrismaService,
      makeCfg(true),
      embedder,
      makeMetrics(),
    );
    const out = await svc.retrieveForCloneRespond({
      tenantId: TENANT,
      scope: 'person',
      scopeRefId: PERSON,
      question: 'q',
      conversationId: 'c1',
    });
    expect(out.map((x) => x.id)).toEqual(['s2', 's1']);
  });

  it('7) recordUsages пишет SkillUsage и обновляет lastUsed + метрики', async () => {
    const prisma = makePrisma();
    const metrics = makeMetrics();
    const svc = new PracticeSkillRetrievalService(
      prisma as unknown as PrismaService,
      makeCfg(true),
      makeEmbedder(null),
      metrics,
    );
    await svc.recordUsages({
      tenantId: TENANT,
      conversationId: 'conv-1',
      messageId: 'msg-1',
      skills: [
        { id: 's1', status: 'active' },
        { id: 's2', status: 'shadow' },
      ],
    });
    expect(prisma.skillUsage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          practiceSkillId: 's1',
          conversationId: 'conv-1',
          messageId: 'msg-1',
          wasUsed: true,
        }),
        expect.objectContaining({ practiceSkillId: 's2' }),
      ],
      skipDuplicates: true,
    });
    expect(prisma.practiceSkill.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] } },
      data: { lastUsed: expect.any(Date) },
    });
    expect(metrics.incPracticeSkillsRun).toHaveBeenCalledWith({
      status: 'active',
    });
    expect(metrics.incPracticeSkillsRun).toHaveBeenCalledWith({
      status: 'shadow',
    });
  });
});
