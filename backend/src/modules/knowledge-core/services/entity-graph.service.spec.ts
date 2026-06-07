import type { Entity, IdeaBlock } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type {
  LlmCallParams,
  LlmRouterService,
} from '../../ai/services/llm-router.service';

import { EntityGraphService } from './entity-graph.service';

/**
 * ТЗ-3 Фаза 1 (устойчивый парсинг JSON в entity-graph): арбитр графа сущностей
 * не должен молча терять связь на невалидном/обёрнутом JSON — lenient-парсер
 * (tryParseJson) + retry (2 попытки, зеркало block-linker) + метрики
 * молчаливой деградации.
 *
 * Покрываем:
 *   1. Валидный JSON-вердикт (конкретный relationType) → корректный verdict.
 *   2. Fenced ```json{...}``` валидный → парсится через tryParseJson (НЕ none).
 *   3. Оба ответа — мусор → 2 попытки → fallback {relationType:null} +
 *      incKcEntityGraphFallbackNone({reason:'exhausted'}) +
 *      incKcEntityGraphInvalidJson({reason:'parse'}) ×2.
 *   4. llm.call бросает оба раза → fallback none +
 *      incKcEntityGraphInvalidJson({reason:'llm_error'}) ×2 + fallback-метрика.
 */
describe('EntityGraphService.judgeRelation (ТЗ-3 Ф1 — устойчивый парсинг)', () => {
  let metrics: {
    incKcEntityGraphInvalidJson: ReturnType<typeof vi.fn>;
    incKcEntityGraphFallbackNone: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    metrics = {
      incKcEntityGraphInvalidJson: vi.fn(),
      incKcEntityGraphFallbackNone: vi.fn(),
    };
  });

  function makeRouterReturning(
    responses: Array<{ text: string } | Error>,
  ): LlmRouterService {
    let i = 0;
    return {
      call: vi.fn(async (_params: LlmCallParams) => {
        const r = responses[i++];
        if (r instanceof Error) throw r;
        return {
          text: r?.text ?? '',
          modelUsed: 'deepseek:deepseek-v4-flash',
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
          durationMs: 100,
        };
      }),
    } as unknown as LlmRouterService;
  }

  function makeEntity(id: string): Entity {
    return {
      id,
      type: 'person',
      canonicalName: `Сущность ${id}`,
      aliases: [],
      metadata: {},
      mentionsCount: 3,
      mergedIntoId: null,
    } as unknown as Entity;
  }

  function makeBlock(id: string): IdeaBlock {
    return {
      id,
      name: `Блок ${id}`,
      criticalQuestion: `Вопрос ${id}?`,
      trustedAnswer: `Ответ ${id}`,
      dataClass: 'internal',
    } as unknown as IdeaBlock;
  }

  const judgeArgs = {
    tenantId: 'org1',
    entityA: makeEntity('A'),
    entityB: makeEntity('B'),
    recentBlocks: [makeBlock('blk1')],
  };

  function makeService(
    router: LlmRouterService,
    withMetrics = false,
  ): EntityGraphService {
    return new EntityGraphService(
      {} as never, // prisma — не нужен для judgeRelation
      router,
      undefined, // cfg
      (withMetrics
        ? (metrics as unknown as BusinessMetricsService)
        : undefined) as never,
    );
  }

  it('валидный JSON-вердикт → корректный verdict', async () => {
    const router = makeRouterReturning([
      {
        text: JSON.stringify({
          relationType: 'works_at',
          confidence: 0.9,
          explanation: 'A работает в B',
          validFromHint: null,
          validUntilHint: null,
          attributes: null,
        }),
      },
    ]);
    const svc = makeService(router);
    const verdict = await svc.judgeRelation(judgeArgs);

    expect(verdict).toEqual(
      expect.objectContaining({
        relationType: 'works_at',
        confidence: 0.9,
        explanation: 'A работает в B',
      }),
    );
    expect(router.call).toHaveBeenCalledTimes(1);
  });

  it('fenced ```json{...}``` валидный → парсится, НЕ none', async () => {
    const router = makeRouterReturning([
      {
        text:
          '```json\n' +
          JSON.stringify({
            relationType: 'depends_on',
            confidence: 0.8,
            explanation: 'A зависит от B',
            validFromHint: null,
            validUntilHint: null,
            attributes: null,
          }) +
          '\n```',
      },
    ]);
    const svc = makeService(router);
    const verdict = await svc.judgeRelation(judgeArgs);

    expect(verdict).toEqual(
      expect.objectContaining({
        relationType: 'depends_on',
        confidence: 0.8,
      }),
    );
    expect(router.call).toHaveBeenCalledTimes(1);
  });

  it('оба ответа мусор → 2 попытки → fallback none + метрики', async () => {
    const router = makeRouterReturning([
      { text: 'это совсем не JSON' },
      { text: 'и это тоже не JSON' },
    ]);
    const svc = makeService(router, true);
    const verdict = await svc.judgeRelation(judgeArgs);

    expect(verdict.relationType).toBeNull();
    expect(verdict.confidence).toBe(0);
    expect(router.call).toHaveBeenCalledTimes(2);
    expect(metrics.incKcEntityGraphInvalidJson).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'parse' }),
    );
    expect(metrics.incKcEntityGraphInvalidJson).toHaveBeenCalledTimes(2);
    expect(metrics.incKcEntityGraphFallbackNone).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'exhausted' }),
    );
  });

  it('llm.call бросает оба раза → fallback none + метрики llm_error', async () => {
    const router = makeRouterReturning([
      new Error('boom-1'),
      new Error('boom-2'),
    ]);
    const svc = makeService(router, true);
    const verdict = await svc.judgeRelation(judgeArgs);

    expect(verdict.relationType).toBeNull();
    expect(router.call).toHaveBeenCalledTimes(2);
    expect(metrics.incKcEntityGraphInvalidJson).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'llm_error' }),
    );
    expect(metrics.incKcEntityGraphInvalidJson).toHaveBeenCalledTimes(2);
    expect(metrics.incKcEntityGraphFallbackNone).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'exhausted' }),
    );
  });

  it('грязный ответ на 1-й попытке + валидный на 2-й → связь строится, метрика invalid_json(parse) один раз', async () => {
    const router = makeRouterReturning([
      { text: 'преамбула без JSON' },
      {
        text: JSON.stringify({
          relationType: 'part_of',
          confidence: 0.77,
          explanation: 'A — часть B',
          validFromHint: null,
          validUntilHint: null,
          attributes: null,
        }),
      },
    ]);
    const svc = makeService(router, true);
    const verdict = await svc.judgeRelation(judgeArgs);

    // Связь НЕ потеряна — ретрай восстановил.
    expect(verdict.relationType).toBe('part_of');
    expect(verdict.confidence).toBe(0.77);
    expect(router.call).toHaveBeenCalledTimes(2);
    expect(metrics.incKcEntityGraphInvalidJson).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'parse' }),
    );
    expect(metrics.incKcEntityGraphInvalidJson).toHaveBeenCalledTimes(1);
    // Терминального fallback НЕ было.
    expect(metrics.incKcEntityGraphFallbackNone).not.toHaveBeenCalled();
  });
});
