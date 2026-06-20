/**
 * Волна 3 — Б27 [K4] unit-тест детерминированного дедупа Insight.
 *
 * До фикса: один и тот же IdeaBlock мог породить дубль Insight, если KNN
 * промахнулся (ретрай / embedding упал / similarity ниже порога). Фикс —
 * прямой pre-check `insight.findFirst({ sourceBlockIds: { has: block.id } })`
 * ПЕРЕД KNN: при существующем активном Insight обогащаем его и выходим,
 * НЕ доходя до embedder/extract/create.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { CurationService } from '../../curation/services/curation.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import type { EntityResolutionService } from './entity-resolution.service';
import { Specialist35Service } from './specialist-3-5-insights.service';
import type { Specialist35ProbeService } from './specialist-3-5-probe.service';

describe('Specialist35Service.processBlock — Б27 [K4] детерминированный дедуп', () => {
  it('существующий Insight по sourceBlockId → обогащаем (update), без create и без KNN', async () => {
    const existingInsight = {
      id: 'ins-1',
      tenantId: 'org-1',
      status: 'active',
      sourceBlockIds: ['b-existing'],
      personSubjectIds: [],
      dynamicLabel: 'stable',
      frequencyScore: { toString: () => '0' },
      dynamicScore: { toString: () => '0' },
    };

    const insightFindFirst = vi.fn(
      async (_args: { where: Record<string, unknown> }) => existingInsight,
    );
    const insightUpdate = vi.fn(async () => ({ ...existingInsight }));
    const insightFindUnique = vi.fn(async () => ({ ...existingInsight }));
    const insightCreate = vi.fn(async () => ({ ...existingInsight, id: 'NEW' }));
    const insightCount = vi.fn(async () => 0);

    const prisma = {
      ideaBlock: {
        findUnique: vi.fn(async () => ({
          id: 'b-1',
          tenantId: 'org-1',
          name: 'Блок боли',
          criticalQuestion: 'В чём проблема?',
          trustedAnswer: 'Клиенты жалуются на скорость',
          signalType: 'pain',
          tags: [],
          dataClass: 'internal',
          createdAt: new Date('2026-01-01'),
          evidence: [],
        })),
        count: insightCount,
      },
      insight: {
        findFirst: insightFindFirst,
        update: insightUpdate,
        findUnique: insightFindUnique,
        create: insightCreate,
      },
      ideaBlockEntity: { findMany: vi.fn(async () => []) },
      person: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaService;

    const embedQuery = vi.fn(async () => [0.1, 0.2, 0.3]);
    const embedder = { embedQuery } as unknown as KnowledgeEmbeddingService;

    const llmCall = vi.fn();
    const llm = { call: llmCall } as unknown as LlmRouterService;

    const cfg = {
      aiFeatures: { promptInjectionGuardEnabled: false },
      dataClassPolicy: { enforcement: 'off' as const },
      insights: {
        clusterThreshold: 0.8,
        frequencyWindowDays: 30,
        spikeRatio: 2,
      },
    } as unknown as TypedConfigService;

    const metrics = {
      incCoreSpecialistExtractionFailure: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
    } as unknown as BusinessMetricsService;

    const probes = {
      checkAndEmitForInsight: vi.fn(async () => undefined),
      emitEscalationSuggested: vi.fn(async () => undefined),
      emitLinkedDecisionQuestion: vi.fn(async () => undefined),
    } as unknown as Specialist35ProbeService;

    const entities = {
      findOrCreateEntity: vi.fn(),
    } as unknown as EntityResolutionService;

    const curation = { triage: vi.fn() } as unknown as CurationService;

    const svc = new Specialist35Service(
      prisma,
      llm,
      embedder,
      entities,
      curation,
      probes,
      metrics,
      cfg,
      undefined,
    );

    await svc.processBlock({ tenantId: 'org-1', blockId: 'b-1' });

    // pre-check выполнен по sourceBlockIds.has(block.id).
    expect(insightFindFirst).toHaveBeenCalledTimes(1);
    const firstArg = insightFindFirst.mock.calls[0]?.[0];
    const whereClause = firstArg?.where as {
      sourceBlockIds?: { has?: string };
    };
    expect(whereClause.sourceBlockIds?.has).toBe('b-1');

    // Обогащение существующего: update вызван, create — нет.
    expect(insightUpdate).toHaveBeenCalled();
    expect(insightCreate).not.toHaveBeenCalled();

    // KNN недостигнут — embedQuery (findMatchingInsight/extract) не дёргался.
    expect(embedQuery).not.toHaveBeenCalled();
    // LLM extract тоже не вызывался (дубль не создаётся).
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('ошибка записи insight.create → processBlock пробрасывает (BullMQ retry) + метрика db_error', async () => {
    const insightCreate = vi.fn(async () => {
      throw new Error('db down');
    });

    const prisma = {
      ideaBlock: {
        findUnique: vi.fn(async () => ({
          id: 'b-1',
          tenantId: 'org-1',
          name: 'Блок боли',
          criticalQuestion: 'В чём проблема?',
          trustedAnswer: 'Клиенты жалуются на скорость',
          signalType: 'pain',
          tags: [],
          dataClass: 'internal',
          createdAt: new Date('2026-01-01'),
          evidence: [],
        })),
      },
      insight: {
        findFirst: vi.fn(async () => null),
        update: vi.fn(),
        findUnique: vi.fn(),
        create: insightCreate,
      },
      ideaBlockEntity: { findMany: vi.fn(async () => []) },
      person: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaService;

    const embedQuery = vi.fn(async () => null);
    const embedder = { embedQuery } as unknown as KnowledgeEmbeddingService;

    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({
        kind: 'problem',
        statement: 'Клиенты жалуются на скорость',
        severity: 'medium',
        affectedEntityHints: [],
        mitigationSuggestion: null,
        causeCategory: 'unknown',
        confidence: 0.7,
      }),
      modelUsed: 'deepseek:deepseek-v4-pro',
      tier: 'primary',
      inputTokens: 10,
      outputTokens: 10,
    }));
    const llm = { call: llmCall } as unknown as LlmRouterService;

    const cfg = {
      aiFeatures: { promptInjectionGuardEnabled: false },
      dataClassPolicy: { enforcement: 'off' as const },
      insights: {
        clusterThreshold: 0.8,
        frequencyWindowDays: 30,
        spikeRatio: 2,
      },
    } as unknown as TypedConfigService;

    const metrics = {
      incCoreSpecialistExtractionFailure: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
    } as unknown as BusinessMetricsService;

    const probes = {
      checkAndEmitForInsight: vi.fn(async () => undefined),
      emitEscalationSuggested: vi.fn(async () => undefined),
      emitLinkedDecisionQuestion: vi.fn(async () => undefined),
    } as unknown as Specialist35ProbeService;

    const entities = {
      findOrCreateEntity: vi.fn(),
    } as unknown as EntityResolutionService;

    const curation = { triage: vi.fn() } as unknown as CurationService;

    const svc = new Specialist35Service(
      prisma,
      llm,
      embedder,
      entities,
      curation,
      probes,
      metrics,
      cfg,
      undefined,
    );

    await expect(
      svc.processBlock({ tenantId: 'org-1', blockId: 'b-1' }),
    ).rejects.toThrow('db down');

    expect(insightCreate).toHaveBeenCalledTimes(1);
    expect(metrics.incCoreSpecialistExtractionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'insight', reason: 'db_error' }),
    );
  });
});
