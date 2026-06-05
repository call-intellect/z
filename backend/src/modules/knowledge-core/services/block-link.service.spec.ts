import type { IdeaBlock } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type {
  LlmCallParams,
  LlmRouterService,
} from '../../ai/services/llm-router.service';

import { BlockLinkService } from './block-link.service';

/**
 * Agents v2 Фаза A1 (2026-05-30) — unit-тест парсинга bi-temporal hint'ов
 * в LLM-vердикте `block-linker`.
 *
 * Покрывает: judge LLM возвращает `{relationType, confidence, explanation,
 * validFrom, validUntil}` → BlockLinkService.judgeLink парсит и
 * возвращает LinkVerdict.validFromHint / validUntilHint.
 */
describe('BlockLinkService.judgeLink — bi-temporal hints (A1)', () => {
  let llmStub: { call: ReturnType<typeof vi.fn> };
  let svc: BlockLinkService;

  beforeEach(() => {
    llmStub = { call: vi.fn() };
    svc = new BlockLinkService(
      {} as never, // prisma — не нужен для judgeLink
      llmStub as unknown as never,
      undefined,
    );
  });

  it('LLM вернул validFrom/validUntil ISO-даты — попадают в verdict.*Hint', async () => {
    llmStub.call.mockResolvedValueOnce({
      text: JSON.stringify({
        relationType: 'develops',
        confidence: 0.9,
        explanation: 'block B уточняет идею A',
        validFrom: '2026-06-01',
        validUntil: '2026-10-01',
      }),
    });

    const verdict = await svc.judgeLink({
      tenantId: 't',
      fromBlock: { id: 'a', name: '', criticalQuestion: '', trustedAnswer: '', signalType: 'fact', tags: [], dataClass: 'public' } as never,
      toBlock: { id: 'b', name: '', criticalQuestion: '', trustedAnswer: '', signalType: 'fact', tags: [], dataClass: 'public' } as never,
    });

    expect(verdict.relationType).toBe('develops');
    expect(verdict.validFromHint).toBe('2026-06-01');
    expect(verdict.validUntilHint).toBe('2026-10-01');
  });

  it('LLM не вернул bi-temporal hints (старая версия промпта) — оба null', async () => {
    llmStub.call.mockResolvedValueOnce({
      text: JSON.stringify({
        relationType: 'develops',
        confidence: 0.85,
        explanation: 'без временных указателей',
        // validFrom/validUntil отсутствуют → backward-compat
      }),
    });

    const verdict = await svc.judgeLink({
      tenantId: 't',
      fromBlock: { id: 'a', name: '', criticalQuestion: '', trustedAnswer: '', signalType: 'fact', tags: [], dataClass: 'public' } as never,
      toBlock: { id: 'b', name: '', criticalQuestion: '', trustedAnswer: '', signalType: 'fact', tags: [], dataClass: 'public' } as never,
    });

    expect(verdict.relationType).toBe('develops');
    expect(verdict.validFromHint).toBeNull();
    expect(verdict.validUntilHint).toBeNull();
  });

  it("LLM вернул 'none' → verdict без validFrom/validUntil", async () => {
    llmStub.call.mockResolvedValueOnce({
      text: JSON.stringify({
        relationType: 'none',
        confidence: 0.1,
        explanation: 'связи нет',
        validFrom: null,
        validUntil: null,
      }),
    });

    const verdict = await svc.judgeLink({
      tenantId: 't',
      fromBlock: { id: 'a', name: '', criticalQuestion: '', trustedAnswer: '', signalType: 'fact', tags: [], dataClass: 'public' } as never,
      toBlock: { id: 'b', name: '', criticalQuestion: '', trustedAnswer: '', signalType: 'fact', tags: [], dataClass: 'public' } as never,
    });

    expect(verdict.relationType).toBeNull();
    // Для 'none' hint'ы не нужны (ребро не создаём).
    expect(verdict.validFromHint).toBeUndefined();
    expect(verdict.validUntilHint).toBeUndefined();
  });
});

/**
 * Фаза 4 (устойчивый парсинг JSON в графе): block-linker не должен молча
 * терять связь на невалидном/обёрнутом JSON арбитра — lenient-парсер
 * (tryParseJson) + retry (2 попытки, зеркало block-ingest) + метрика
 * молчаливой деградации.
 *
 * Покрываем:
 *   1. Валидный JSON-вердикт (конкретный relationType) → корректный verdict.
 *   2. Fenced ```json{...}``` валидный → парсится через tryParseJson (НЕ none).
 *   3. Оба ответа — мусор → 2 попытки → fallback {relationType:null} +
 *      incKcBlockLinkerFallbackNone({reason:'exhausted'}).
 *   4. llm.call бросает оба раза → fallback none + метрика.
 */
describe('BlockLinkService.judgeLink (Фаза 4 — устойчивый парсинг)', () => {
  function makeMetrics(): BusinessMetricsService {
    return {
      incKcBlockLinkerFallbackNone: vi.fn(),
    } as unknown as BusinessMetricsService;
  }

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

  function makeBlock(id: string): IdeaBlock {
    return {
      id,
      name: `Блок ${id}`,
      criticalQuestion: `Вопрос ${id}?`,
      trustedAnswer: `Ответ ${id}`,
      signalType: 'fact',
      tags: ['t'],
      dataClass: 'internal',
    } as unknown as IdeaBlock;
  }

  const linkArgs = {
    tenantId: 'org1',
    fromBlock: makeBlock('A'),
    toBlock: makeBlock('B'),
  };

  it('валидный JSON-вердикт → корректный verdict', async () => {
    const router = makeRouterReturning([
      {
        text: JSON.stringify({
          relationType: 'develops',
          confidence: 0.9,
          explanation: 'B развивает A',
          validFrom: null,
          validUntil: null,
        }),
      },
    ]);
    const svc = new BlockLinkService({} as never, router, undefined);
    const verdict = await svc.judgeLink(linkArgs);

    expect(verdict).toEqual(
      expect.objectContaining({
        relationType: 'develops',
        confidence: 0.9,
        explanation: 'B развивает A',
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
            relationType: 'causes',
            confidence: 0.8,
            explanation: 'A влечёт B',
            validFrom: null,
            validUntil: null,
          }) +
          '\n```',
      },
    ]);
    const svc = new BlockLinkService({} as never, router, undefined);
    const verdict = await svc.judgeLink(linkArgs);

    expect(verdict).toEqual(
      expect.objectContaining({
        relationType: 'causes',
        confidence: 0.8,
      }),
    );
    expect(router.call).toHaveBeenCalledTimes(1);
  });

  it('оба ответа мусор → 2 попытки → fallback none + метрика', async () => {
    const router = makeRouterReturning([
      { text: 'это совсем не JSON' },
      { text: 'и это тоже не JSON' },
    ]);
    const metrics = makeMetrics();
    const svc = new BlockLinkService({} as never, router, undefined, metrics);
    const verdict = await svc.judgeLink(linkArgs);

    expect(verdict.relationType).toBeNull();
    expect(verdict.confidence).toBe(0);
    expect(router.call).toHaveBeenCalledTimes(2);
    expect(metrics.incKcBlockLinkerFallbackNone).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'exhausted' }),
    );
  });

  it('llm.call бросает оба раза → fallback none + метрика', async () => {
    const router = makeRouterReturning([
      new Error('boom-1'),
      new Error('boom-2'),
    ]);
    const metrics = makeMetrics();
    const svc = new BlockLinkService({} as never, router, undefined, metrics);
    const verdict = await svc.judgeLink(linkArgs);

    expect(verdict.relationType).toBeNull();
    expect(router.call).toHaveBeenCalledTimes(2);
    expect(metrics.incKcBlockLinkerFallbackNone).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'exhausted' }),
    );
  });
});
