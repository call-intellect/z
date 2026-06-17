import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { ConflictService } from '../../curation/services/conflict.service';

import { FactSupersedeService } from './fact-supersede.service';

function makeMocks() {
  const blockUnique = vi.fn();
  const blockUpdateMany = vi.fn();
  const linkUpsert = vi.fn();
  const queryRawUnsafe = vi.fn();
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb({
      ideaBlock: { updateMany: blockUpdateMany },
      ideaBlockLink: { upsert: linkUpsert },
    });
  });
  const prisma = {
    ideaBlock: { findUnique: blockUnique },
    $queryRawUnsafe: queryRawUnsafe,
    $transaction: transaction,
  } as unknown as PrismaService;

  const redisSet = vi.fn(async (): Promise<string | null> => 'OK');
  const redisDel = vi.fn(async () => 1);
  const redis = {
    client: { set: redisSet, del: redisDel },
  } as unknown as RedisService;

  const llmCall = vi.fn();
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const conflictReport = vi.fn(async (_input: Record<string, unknown>) => ({
    id: 'conflict-1',
  }));
  const conflicts = {
    report: conflictReport,
  } as unknown as ConflictService;

  const metrics = {
    observeKcFactSupersedeLatencyMs: vi.fn(),
    incKcFactSupersedeVerdict: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    bitemporal: {
      enabled: true,
      supersedeEnabled: true,
      factSignalTypes: ['fact', 'commitment'],
      factSupersedeCosineThreshold: 0.85,
      factSupersedeKnnTopK: 5,
      factSupersedeCostAlertPct: 5,
    },
    aiFeatures: { promptInjectionGuardEnabled: false },
  } as unknown as TypedConfigService;

  return {
    prisma,
    redis,
    llm,
    conflicts,
    metrics,
    cfg,
    spies: {
      blockUnique,
      blockUpdateMany,
      linkUpsert,
      queryRawUnsafe,
      transaction,
      redisSet,
      redisDel,
      llmCall,
      conflictReport,
      metrics,
    },
  };
}

function makeBlock(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'blk-new',
    tenantId: 'org-1',
    name: 'new fact',
    criticalQuestion: 'q',
    trustedAnswer: 'a',
    signalType: 'fact',
    dataClass: 'internal',
    validFrom: new Date('2026-05-25T10:00:00Z'),
    validUntil: null,
    supersededById: null,
    evidence: [],
    ...over,
  };
}

describe('FactSupersedeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skip_not_fact_signal — signalType не в списке factual', async () => {
    const m = makeMocks();
    m.spies.blockUnique.mockResolvedValueOnce(makeBlock({ signalType: 'pain' }));
    const svc = new FactSupersedeService(m.prisma, m.redis, m.llm, m.conflicts, m.metrics, m.cfg);

    const r = await svc.processNewBlock('blk-new');

    expect(r).toEqual({ verdict: 'skip_not_fact_signal', applied: false });
    expect(m.spies.queryRawUnsafe).not.toHaveBeenCalled();
    expect(m.spies.llmCall).not.toHaveBeenCalled();
    expect(m.spies.redisSet).not.toHaveBeenCalled();
    expect(m.metrics.incKcFactSupersedeVerdict).toHaveBeenCalledWith({
      verdict: 'skip_not_fact_signal',
    });
  });

  it('skip_no_candidates — KNN вернул пусто, LLM не вызывается', async () => {
    const m = makeMocks();
    m.spies.blockUnique.mockResolvedValueOnce(makeBlock());
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]);
    const svc = new FactSupersedeService(m.prisma, m.redis, m.llm, m.conflicts, m.metrics, m.cfg);

    const r = await svc.processNewBlock('blk-new');

    expect(r).toEqual({ verdict: 'skip_no_candidates', applied: false });
    expect(m.spies.llmCall).not.toHaveBeenCalled();
    expect(m.spies.transaction).not.toHaveBeenCalled();
    expect(m.spies.redisDel).toHaveBeenCalled();
    expect(m.metrics.incKcFactSupersedeVerdict).toHaveBeenCalledWith({
      verdict: 'skip_no_candidates',
    });
  });

  it('supersedes happy path — closes old block + creates link + conflict', async () => {
    const m = makeMocks();
    m.spies.blockUnique.mockResolvedValueOnce(makeBlock());
    m.spies.queryRawUnsafe.mockResolvedValueOnce([
      {
        id: 'blk-old',
        name: 'old fact',
        criticalQuestion: 'q',
        trustedAnswer: 'old a',
        signalType: 'fact',
        validFrom: new Date('2026-05-01T10:00:00Z'),
        similarity: 0.93,
      },
    ]);
    m.spies.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'supersedes',
        targetBlockId: 'blk-old',
        reason: 'новый факт явно отменяет старый',
        confidence: 0.92,
      }),
    });
    m.spies.blockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const svc = new FactSupersedeService(m.prisma, m.redis, m.llm, m.conflicts, m.metrics, m.cfg);

    const r = await svc.processNewBlock('blk-new');

    expect(r.verdict).toBe('supersedes');
    expect(r.targetId).toBe('blk-old');
    expect(r.applied).toBe(true);

    expect(m.spies.blockUpdateMany).toHaveBeenCalledTimes(1);
    const updArgs = (m.spies.blockUpdateMany.mock.calls[0] ?? [])[0] as
      | {
          where: { id: string; validUntil: null };
          data: { validUntil: Date; supersededById: string };
        }
      | undefined;
    expect(updArgs).toBeDefined();
    expect(updArgs!.where.id).toBe('blk-old');
    expect(updArgs!.where.validUntil).toBeNull();
    expect(updArgs!.data.supersededById).toBe('blk-new');

    expect(m.spies.linkUpsert).toHaveBeenCalledTimes(1);
    const linkArgs = (m.spies.linkUpsert.mock.calls[0] ?? [])[0] as
      | {
          create: {
            fromBlockId: string;
            toBlockId: string;
            relationType: string;
          };
        }
      | undefined;
    expect(linkArgs).toBeDefined();
    expect(linkArgs!.create.fromBlockId).toBe('blk-new');
    expect(linkArgs!.create.toBlockId).toBe('blk-old');
    expect(linkArgs!.create.relationType).toBe('supersedes');

    expect(m.spies.conflictReport).toHaveBeenCalledTimes(1);
    const confArgs = (m.spies.conflictReport.mock.calls[0] ?? [])[0] as
      | {
          resourceType: string;
          existingId: string;
          newId: string;
          relationType: string;
          evidence: { suggestedResolution: string };
        }
      | undefined;
    expect(confArgs).toBeDefined();
    expect(confArgs!.resourceType).toBe('idea_block');
    expect(confArgs!.existingId).toBe('blk-old');
    expect(confArgs!.newId).toBe('blk-new');
    expect(confArgs!.relationType).toBe('supersedes');
    expect(confArgs!.evidence.suggestedResolution).toBe('evolving');

    expect(m.metrics.incKcFactSupersedeVerdict).toHaveBeenCalledWith({
      verdict: 'supersedes',
    });
  });

  it('race-condition — два параллельных вызова: один applied, второй skip_race_lost', async () => {
    const m = makeMocks();
    m.spies.blockUnique.mockResolvedValue(makeBlock());
    m.spies.queryRawUnsafe.mockResolvedValue([
      {
        id: 'blk-old',
        name: 'old fact',
        criticalQuestion: 'q',
        trustedAnswer: 'old a',
        signalType: 'fact',
        validFrom: new Date('2026-05-01T10:00:00Z'),
        similarity: 0.93,
      },
    ]);
    m.spies.llmCall.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'supersedes',
        targetBlockId: 'blk-old',
        reason: 'reason',
        confidence: 0.9,
      }),
    });
    let setCallNo = 0;
    m.spies.redisSet.mockImplementation(async () => {
      setCallNo++;
      return setCallNo === 1 ? 'OK' : null;
    });
    m.spies.blockUpdateMany.mockResolvedValue({ count: 1 });

    const svc = new FactSupersedeService(m.prisma, m.redis, m.llm, m.conflicts, m.metrics, m.cfg);

    const [r1, r2] = await Promise.all([
      svc.processNewBlock('blk-new'),
      svc.processNewBlock('blk-new'),
    ]);

    const verdicts = [r1.verdict, r2.verdict].sort();
    expect(verdicts).toEqual(['skip_race_lost', 'supersedes']);
    const appliedFlags = [r1.applied, r2.applied].filter(Boolean);
    expect(appliedFlags).toHaveLength(1);

    expect(m.spies.llmCall).toHaveBeenCalledTimes(1);
    expect(m.spies.blockUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.spies.conflictReport).toHaveBeenCalledTimes(1);
  });
});
