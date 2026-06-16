import type { PromptFeedback, PromptRule } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

import { AutoRuleExtractorService } from './autorule-extractor.service';

function fb(i: number, opts?: Partial<PromptFeedback>): PromptFeedback {
  return {
    id: `fb-${i}`,
    tenantId: 'org-1',
    promptKey: 'meeting-report-fast',
    promptVersion: 'deepseek:deepseek-v4-pro',
    invocationId: `inv-${i}`,
    inputDigest: `digest-${i}`,
    inputEmbedding: null as unknown,
    originalOutput: `original text ${i}`,
    editedOutput: `edited text ${i}`,
    editDistance: 0.4,
    editedAt: new Date(),
    editedByUserId: 'user-1',
    downstreamSignals: null,
    createdAt: new Date(),
    ...opts,
  } as PromptFeedback;
}

interface PartialPrisma {
  promptFeedback: {
    findMany: ReturnType<typeof vi.fn>;
  };
  promptRule: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
}

function makePrisma(args?: {
  feedback?: PromptFeedback[];
  rawSelectRows?: Array<{ id: string; emb: string | null }>;
  findFirstRule?: PromptRule | null;
  similarRule?: PromptRule | null;
}): PartialPrisma {
  return {
    promptFeedback: {
      findMany: vi.fn().mockResolvedValue(args?.feedback ?? []),
    },
    promptRule: {
      findFirst: vi.fn().mockResolvedValue(args?.findFirstRule ?? null),
      findUnique: vi.fn().mockResolvedValue(args?.similarRule ?? null),
      create: vi.fn().mockImplementation(
        async ({ data }) =>
          ({
            id: `rule-${Math.random().toString(36).slice(2, 8)}`,
            tenantId: data.tenantId,
            promptKey: data.promptKey,
            rule: data.rule,
            ruleType: data.ruleType,
            source: data.source,
            status: data.status,
            confidence: data.confidence,
            examples: data.examples,
            shadowMetrics: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            promotedAt: null,
            archivedAt: null,
            archivedReason: null,
          }) as PromptRule,
      ),
      update: vi.fn().mockResolvedValue({} as PromptRule),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue(args?.rawSelectRows ?? []),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  };
}

function makeCfg(): TypedConfigService {
  return {
    autorule: {
      enabled: true,
      minFeedbackForExtract: 10,
      minConfidenceForPromote: 0.7,
      knnGroupThreshold: 0.78,
      ruleSimilarityThreshold: 0.9,
    },
  } as unknown as TypedConfigService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incAutoruleExtracted: vi.fn(),
  } as unknown as BusinessMetricsService;
}

function buildService(args: {
  prisma: PartialPrisma;
  llmCall: ReturnType<typeof vi.fn>;
  embed?: ReturnType<typeof vi.fn>;
}): AutoRuleExtractorService {
  const llm = { call: args.llmCall } as unknown as LlmRouterService;
  const embeddings = args.embed
    ? ({ embed: args.embed } as unknown as EmbeddingFallbackService)
    : undefined;
  return new AutoRuleExtractorService(
    args.prisma as unknown as PrismaService,
    llm,
    makeCfg(),
    makeMetrics(),
    embeddings,
  );
}

describe('AutoRuleExtractorService.extractForPromptKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('<10 feedback → пустой возврат, LLM не вызывался', async () => {
    const prisma = makePrisma({ feedback: Array.from({ length: 5 }, (_, i) => fb(i)) });
    const llmCall = vi.fn();
    const svc = buildService({ prisma, llmCall });

    const rules = await svc.extractForPromptKey('meeting-report-fast', 'org-1');

    expect(rules).toEqual([]);
    expect(llmCall).not.toHaveBeenCalled();
    expect(prisma.promptRule.create).not.toHaveBeenCalled();
  });

  it('12 feedback / 3 KNN-группы (через inputDigest fallback) → 3 candidate rules', async () => {
    const items: PromptFeedback[] = [];
    for (let g = 0; g < 3; g++) {
      for (let i = 0; i < 4; i++) {
        items.push(fb(g * 4 + i, { inputDigest: `digest-group-${g}` }));
      }
    }
    const prisma = makePrisma({ feedback: items });
    const llmCall = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        rule: 'Всегда добавлять короткий список Action Items в конце.',
        ruleType: 'must_do',
        confidence: 0.88,
        examples: [
          { originalSnippet: 'orig', editedSnippet: 'edited', why: 'добавлен список действий' },
        ],
        reasoning: 'В каждой паре пользователь добавляет список действий.',
      }),
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 100,
      outputTokens: 100,
      cachedTokens: 0,
      durationMs: 1,
    });
    const svc = buildService({ prisma, llmCall });

    const rules = await svc.extractForPromptKey('meeting-report-fast', 'org-1');

    expect(rules).toHaveLength(3);
    expect(llmCall).toHaveBeenCalledTimes(3);
    expect(prisma.promptRule.create).toHaveBeenCalledTimes(3);
    const createCall = prisma.promptRule.create.mock.calls[0]?.[0] as
      | { data: { status: string; source: string } }
      | undefined;
    expect(createCall?.data.status).toBe('shadow');
    expect(createCall?.data.source).toBe('autorule');
  });

  it('confidence < threshold → правило не создаётся', async () => {
    const items = Array.from({ length: 12 }, (_, i) => fb(i, { inputDigest: 'same-digest' }));
    const prisma = makePrisma({ feedback: items });
    const llmCall = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        rule: 'Слабый сигнал',
        ruleType: 'tone',
        confidence: 0.4,
        examples: [{ originalSnippet: 'o', editedSnippet: 'e', why: 'why' }],
        reasoning: 'weak',
      }),
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    });
    const svc = buildService({ prisma, llmCall });

    const rules = await svc.extractForPromptKey('meeting-report-fast', 'org-1');

    expect(rules).toEqual([]);
    expect(prisma.promptRule.create).not.toHaveBeenCalled();
  });

  it('existing overridden_by_admin → skip (sticky)', async () => {
    const items = Array.from({ length: 12 }, (_, i) => fb(i, { inputDigest: 'same-digest' }));
    const overridden: PromptRule = {
      id: 'rule-over',
      tenantId: 'org-1',
      promptKey: 'meeting-report-fast',
      rule: 'Всегда добавлять короткий список Action Items в конце.',
      ruleType: 'must_do',
      source: 'autorule',
      status: 'overridden_by_admin',
      examples: [],
      confidence: 0.9,
      shadowMetrics: null,
      embedding: null as unknown,
      createdAt: new Date(),
      updatedAt: new Date(),
      promotedAt: null,
      archivedAt: null,
      archivedReason: null,
    } as PromptRule;
    const prisma = makePrisma({
      feedback: items,
      findFirstRule: overridden,
    });
    const llmCall = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        rule: 'Всегда добавлять короткий список Action Items в конце.',
        ruleType: 'must_do',
        confidence: 0.9,
        examples: [{ originalSnippet: 'o', editedSnippet: 'e', why: 'why' }],
        reasoning: 'обоснование',
      }),
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    });
    const svc = buildService({ prisma, llmCall });

    const rules = await svc.extractForPromptKey('meeting-report-fast', 'org-1');

    expect(rules).toEqual([]);
    expect(prisma.promptRule.create).not.toHaveBeenCalled();
  });
});
