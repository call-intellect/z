import type { PracticeSkill } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { PracticeSkillEvaluatorService } from './practice-skill-evaluator.service';

const TENANT = 'org-1';
const SKILL_ID = 'skill-1';

function makeSkill(): PracticeSkill {
  return {
    id: SKILL_ID,
    tenantId: TENANT,
    scope: 'person',
    scopeRefId: 'person-1',
    trigger: 'когда X',
    steps: [{ order: 1, action: 'A' }] as unknown as object,
    examples: [] as unknown as object,
    redFlags: [] as unknown as object,
    status: 'shadow',
    trafficShare: 0.1,
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
  } as unknown as PracticeSkill;
}

function makeCfg(
  opts?: Partial<{
    evalMinRuns: number;
    evalPromoteDelta: number;
    evalArchiveDelta: number;
  }>,
): TypedConfigService {
  return {
    practiceSkills: {
      enabled: true,
      minTraitsForExtract: 5,
      shadowTrafficShare: 0.1,
      knnRetrievalThreshold: 0.78,
      knnDedupThreshold: 0.85,
      evalMinRuns: opts?.evalMinRuns ?? 30,
      evalPromoteDelta: opts?.evalPromoteDelta ?? 0.05,
      evalArchiveDelta: opts?.evalArchiveDelta ?? 0.05,
    },
  } as unknown as TypedConfigService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    observePracticeSkillsCompositeVsBaseline: vi.fn(),
    incPracticeSkillsPromoted: vi.fn(),
    incPracticeSkillsArchived: vi.fn(),
  } as unknown as BusinessMetricsService;
}

interface MockPrisma {
  practiceSkill: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  skillUsage: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  chatV2Message: { findUnique: ReturnType<typeof vi.fn> };
  chatV2Conversation: { findMany: ReturnType<typeof vi.fn> };
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
}

function makePrisma(args?: {
  skill?: PracticeSkill | null;
  usages?: Array<{
    id: string;
    outcome: string | null;
    editDistance: number | null;
    conversationId: string;
    messageId: string;
  }>;
  otherUsages?: Array<{ outcome: string | null; editDistance: number | null }>;
}): MockPrisma {
  return {
    practiceSkill: {
      findUnique: vi.fn().mockResolvedValue(args?.skill ?? null),
      update: vi.fn().mockImplementation(async ({ data }) => ({
        ...(args?.skill as PracticeSkill),
        ...data,
      })),
    },
    skillUsage: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(args?.usages ?? [])
        .mockResolvedValueOnce(
          (args?.usages ?? []).map((u) => ({
            conversationId: u.conversationId,
          })),
        )
        .mockResolvedValueOnce(args?.otherUsages ?? []),
      findUnique: vi.fn().mockResolvedValue({
        id: 'usage-1',
        practiceSkill: {
          id: SKILL_ID,
          trigger: 'когда X',
          steps: [{ order: 1, action: 'a' }],
          redFlags: [],
        },
      }),
    },
    chatV2Message: {
      findUnique: vi.fn().mockResolvedValue({ text: 'ответ клона' }),
    },
    chatV2Conversation: {
      findMany: vi.fn().mockResolvedValue([{ id: 'conv-other-1' }]),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  };
}

function makeLlmAlwaysOk(): LlmRouterService {
  return {
    call: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        violatesRedFlags: false,
        contradictsSteps: false,
        reasoning: 'ok',
      }),
      modelUsed: 'deepseek-v4-flash',
      inputTokens: 50,
      outputTokens: 30,
      tier: 'primary',
    }),
  } as unknown as LlmRouterService;
}

describe('PracticeSkillEvaluatorService', () => {
  it('1) <evalMinRuns usages → hold (нет update статуса)', async () => {
    const skill = makeSkill();
    const prisma = makePrisma({
      skill,
      usages: [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `u-${i}`,
          outcome: 'accepted_as_is',
          editDistance: 0.1,
          conversationId: `conv-${i}`,
          messageId: `msg-${i}`,
        })),
      ],
    });
    const svc = new PracticeSkillEvaluatorService(
      prisma as unknown as PrismaService,
      makeCfg({ evalMinRuns: 30 }),
      makeLlmAlwaysOk(),
      makeMetrics(),
    );
    const action = await svc.evaluateOne(SKILL_ID);
    expect(action).toBe('hold');
    expect(prisma.practiceSkill.update).not.toHaveBeenCalled();
  });

  it('2) composite > baseline + promoteDelta → promote', async () => {
    const skill = makeSkill();
    const usages = Array.from({ length: 30 }, (_, i) => ({
      id: `u-${i}`,
      outcome: 'accepted_as_is',
      editDistance: 0.0,
      conversationId: `conv-${i}`,
      messageId: `msg-${i}`,
    }));
    const prisma = makePrisma({
      skill,
      usages,
      otherUsages: [],
    });
    const metrics = makeMetrics();
    const svc = new PracticeSkillEvaluatorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      makeLlmAlwaysOk(),
      metrics,
    );
    const action = await svc.evaluateOne(SKILL_ID);
    expect(action).toBe('promote');
    expect(prisma.practiceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
          trafficShare: 1.0,
          promotedAt: expect.any(Date),
        }),
      }),
    );
    expect(metrics.incPracticeSkillsPromoted).toHaveBeenCalled();
  });

  it('3) composite < baseline - archiveDelta → archive', async () => {
    const skill = makeSkill();
    const usages = Array.from({ length: 30 }, (_, i) => ({
      id: `u-${i}`,
      outcome: 'rejected',
      editDistance: 0.9,
      conversationId: `conv-${i}`,
      messageId: `msg-${i}`,
    }));
    const otherUsages = Array.from({ length: 50 }, () => ({
      outcome: 'accepted_as_is',
      editDistance: 0.0,
    }));
    const prisma = makePrisma({ skill, usages, otherUsages });
    const metrics = makeMetrics();
    const svc = new PracticeSkillEvaluatorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      makeLlmAlwaysOk(),
      metrics,
    );
    const action = await svc.evaluateOne(SKILL_ID);
    expect(action).toBe('archive');
    expect(prisma.practiceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'archived',
          archivedReason: 'shadow_metrics_worse_than_baseline',
          archivedAt: expect.any(Date),
        }),
      }),
    );
    expect(metrics.incPracticeSkillsArchived).toHaveBeenCalled();
  });

  it('4) hold — между порогами, только shadowMetrics обновляется', async () => {
    const skill = makeSkill();
    const usages = Array.from({ length: 30 }, (_, i) => ({
      id: `u-${i}`,
      outcome: i % 2 === 0 ? 'accepted_as_is' : 'rejected',
      editDistance: 0.5,
      conversationId: `conv-${i}`,
      messageId: `msg-${i}`,
    }));
    const otherUsages = Array.from({ length: 50 }, (_, i) => ({
      outcome: i % 2 === 0 ? 'accepted_as_is' : 'rejected',
      editDistance: 0.5,
    }));
    const prisma = makePrisma({ skill, usages, otherUsages });
    const svc = new PracticeSkillEvaluatorService(
      prisma as unknown as PrismaService,
      makeCfg(),
      makeLlmAlwaysOk(),
      makeMetrics(),
    );
    const action = await svc.evaluateOne(SKILL_ID);
    expect(action).toBe('hold');
    expect(prisma.practiceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shadowMetrics: expect.any(Object),
        }),
      }),
    );
    const updateCall = (prisma.practiceSkill.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(updateCall.data.status).toBeUndefined();
    expect(updateCall.data.promotedAt).toBeUndefined();
    expect(updateCall.data.archivedAt).toBeUndefined();
  });
});
