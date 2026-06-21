import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

import { SubjectMemoryService } from './subject-memory.service';

interface TxMock {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
  subjectMemory: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function makeService(args: {
  enabled?: boolean;
  llmResponse?: unknown;
  candidateRows?: Array<{
    id: string;
    occurredAt: Date;
    confirmCount: number;
    similarity: number;
  }>;
  matchMinSimilarity?: number;
  suppressMinConfidence?: number;
  applicableRows?: Array<{
    id: string;
    kind: string;
    ruleText: string;
    confidence: number | string;
    similarity: number | string;
  }>;
}): {
  svc: SubjectMemoryService;
  llmCall: ReturnType<typeof vi.fn>;
  embed: ReturnType<typeof vi.fn>;
  tx: TxMock;
  queryRawUnsafe: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  metrics: {
    incSubjectMemoryRuleExtracted: ReturnType<typeof vi.fn>;
    incSubjectMemoryApply: ReturnType<typeof vi.fn>;
  };
} {
  const llmCall = vi.fn().mockResolvedValue({
    text: JSON.stringify(args.llmResponse ?? {}),
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const embed = vi.fn().mockResolvedValue([new Array(1536).fill(0.01)]);
  const embeddings = { embed } as unknown as EmbeddingFallbackService;

  const tx: TxMock = {
    $queryRawUnsafe: vi.fn().mockResolvedValue(args.candidateRows ?? []),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    subjectMemory: {
      create: vi.fn().mockResolvedValue({ id: 'sm-new' }),
      update: vi.fn().mockResolvedValue({ id: 'sm-cand' }),
    },
  };
  const queryRawUnsafe = vi.fn().mockResolvedValue(args.applicableRows ?? []);
  const update = vi.fn().mockResolvedValue({ id: 'sm-applied' });
  const prisma = {
    $transaction: vi.fn(async (cb: (t: TxMock) => Promise<unknown>) => cb(tx)),
    $queryRawUnsafe: queryRawUnsafe,
    subjectMemory: { update },
  } as unknown as PrismaService;

  const incSubjectMemoryRuleExtracted = vi.fn();
  const incSubjectMemoryApply = vi.fn();
  const metrics = {
    incSubjectMemoryRuleExtracted,
    incSubjectMemoryApply,
  } as unknown as BusinessMetricsService;

  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    subjectMemory: {
      enabled: args.enabled ?? true,
      matchMinSimilarity: args.matchMinSimilarity ?? 0.82,
      suppressMinConfidence: args.suppressMinConfidence ?? 0.7,
    },
  } as unknown as TypedConfigService;

  const svc = new SubjectMemoryService(prisma, llm, embeddings, metrics, cfg);
  return {
    svc,
    llmCall,
    embed,
    tx,
    queryRawUnsafe,
    update,
    metrics: { incSubjectMemoryRuleExtracted, incSubjectMemoryApply },
  };
}

const REUSABLE_TERM = {
  isReusable: true,
  kind: 'term',
  contextText: 'КП',
  ruleText: 'КП = коммерческое предложение',
  confidence: 0.9,
};

describe('SubjectMemoryService.deriveRuleFromProbeResponse', () => {
  it('извлекает новое правило (нет кандидата) → create shadow + embedding + метрика', async () => {
    const { svc, tx, metrics, embed } = makeService({
      llmResponse: REUSABLE_TERM,
      candidateRows: [],
    });

    await svc.deriveRuleFromProbeResponse({
      tenantId: 'org-1',
      probeId: 'probe-1',
      questionText: 'Что такое КП?',
      answerText: 'Коммерческое предложение',
      occurredAt: new Date('2026-06-21T10:00:00Z'),
    });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(tx.subjectMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'shadow',
          kind: 'term',
          ruleText: 'КП = коммерческое предложение',
          confirmCount: 0,
        }),
      }),
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
    expect(tx.subjectMemory.update).not.toHaveBeenCalled();
    expect(metrics.incSubjectMemoryRuleExtracted).toHaveBeenCalledWith({
      kind: 'term',
    });
  });

  it('supersede: новый ответ свежее кандидата → create + старый superseded', async () => {
    const candidateOccurredAt = new Date('2026-06-01T10:00:00Z');
    const { svc, tx } = makeService({
      llmResponse: REUSABLE_TERM,
      candidateRows: [
        {
          id: 'sm-old',
          occurredAt: candidateOccurredAt,
          confirmCount: 3,
          similarity: 0.95,
        },
      ],
    });

    await svc.deriveRuleFromProbeResponse({
      tenantId: 'org-1',
      probeId: 'probe-2',
      questionText: 'Что такое КП?',
      answerText: 'Коммерческое предложение',
      occurredAt: new Date('2026-06-21T10:00:00Z'),
    });

    expect(tx.subjectMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'shadow',
          confirmCount: 4,
        }),
      }),
    );
    expect(tx.subjectMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-old' },
        data: expect.objectContaining({
          status: 'superseded',
          supersededById: 'sm-new',
        }),
      }),
    );
  });

  it('supersede: кандидат свежее → confirmCount++ без create', async () => {
    const { svc, tx } = makeService({
      llmResponse: REUSABLE_TERM,
      candidateRows: [
        {
          id: 'sm-fresh',
          occurredAt: new Date('2026-06-25T10:00:00Z'),
          confirmCount: 1,
          similarity: 0.95,
        },
      ],
    });

    await svc.deriveRuleFromProbeResponse({
      tenantId: 'org-1',
      probeId: 'probe-3',
      questionText: 'Что такое КП?',
      answerText: 'Коммерческое предложение',
      occurredAt: new Date('2026-06-21T10:00:00Z'),
    });

    expect(tx.subjectMemory.create).not.toHaveBeenCalled();
    expect(tx.subjectMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sm-fresh' },
        data: { confirmCount: { increment: 1 } },
      }),
    );
  });

  it('негатив: isReusable=false → ни create, ни метрика', async () => {
    const { svc, tx, metrics, embed } = makeService({
      llmResponse: { ...REUSABLE_TERM, isReusable: false },
    });

    await svc.deriveRuleFromProbeResponse({
      tenantId: 'org-1',
      probeId: 'probe-4',
      questionText: 'Q',
      answerText: 'A',
      occurredAt: new Date('2026-06-21T10:00:00Z'),
    });

    expect(embed).not.toHaveBeenCalled();
    expect(tx.subjectMemory.create).not.toHaveBeenCalled();
    expect(metrics.incSubjectMemoryRuleExtracted).not.toHaveBeenCalled();
  });

  it('kill-switch: enabled=false → LLM не вызывается', async () => {
    const { svc, llmCall } = makeService({
      enabled: false,
      llmResponse: REUSABLE_TERM,
    });

    await svc.deriveRuleFromProbeResponse({
      tenantId: 'org-1',
      probeId: 'probe-5',
      questionText: 'Q',
      answerText: 'A',
      occurredAt: new Date('2026-06-21T10:00:00Z'),
    });

    expect(llmCall).not.toHaveBeenCalled();
  });
});

describe('SubjectMemoryService.findApplicableRule', () => {
  it('читает только status IN (active, canary)', async () => {
    const { svc, queryRawUnsafe } = makeService({
      applicableRows: [
        {
          id: 'r1',
          kind: 'term',
          ruleText: 'КП = коммерческое предложение',
          confidence: 0.9,
          similarity: 0.95,
        },
      ],
    });

    await svc.findApplicableRule('org-1', 'термин КП');

    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('active', 'canary')"),
      expect.anything(),
      expect.anything(),
    );
  });

  it('ниже matchMinSimilarity → null', async () => {
    const { svc } = makeService({
      matchMinSimilarity: 0.82,
      applicableRows: [
        {
          id: 'r1',
          kind: 'term',
          ruleText: 'правило',
          confidence: 0.9,
          similarity: 0.5,
        },
      ],
    });

    const rule = await svc.findApplicableRule('org-1', 'термин КП');
    expect(rule).toBeNull();
  });

  it('ниже suppressMinConfidence → null', async () => {
    const { svc } = makeService({
      suppressMinConfidence: 0.7,
      applicableRows: [
        {
          id: 'r1',
          kind: 'term',
          ruleText: 'правило',
          confidence: 0.4,
          similarity: 0.95,
        },
      ],
    });

    const rule = await svc.findApplicableRule('org-1', 'термин КП');
    expect(rule).toBeNull();
  });

  it('выше обоих порогов → объект + appliedCount increment + метрика', async () => {
    const { svc, update, metrics } = makeService({
      applicableRows: [
        {
          id: 'r1',
          kind: 'term',
          ruleText: 'КП = коммерческое предложение',
          confidence: 0.9,
          similarity: 0.95,
        },
      ],
    });

    const rule = await svc.findApplicableRule('org-1', 'термин КП');
    expect(rule).toEqual(
      expect.objectContaining({
        id: 'r1',
        kind: 'term',
        ruleText: 'КП = коммерческое предложение',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          appliedCount: { increment: 1 },
        }),
      }),
    );
    expect(metrics.incSubjectMemoryApply).toHaveBeenCalledWith({
      status: 'suppressed',
    });
  });
});
