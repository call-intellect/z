import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { ChapterExtractionService } from './chapter-extraction.service';
import type { LlmCallParams, LlmRouterService } from './llm-router.service';
import { CHAPTERS_JSON_SCHEMA } from './prompts/chapters';

/**
 * T7-F6 — что покрываем:
 *   1. ExtractChapters передаёт `responseFormat: { type: 'json_schema', strict: true }`
 *      с CHAPTERS_JSON_SCHEMA в LlmRouter (а не legacy `json_object`).
 *   2. Парсит wrapped формат `{ chapters: [...] }` от провайдера со strict-support.
 *   3. Парсит bare `[...]` формат (legacy провайдер без strict — формат старый).
 *   4. На невалидный JSON инкрементирует z_prompt_invalid_response_total{reason='json_parse'}
 *      и делает ретрай.
 *   5. На невалидную схему — z_prompt_invalid_response_total{reason='schema'}.
 */
describe('ChapterExtractionService (T7-F6 json_schema)', () => {
  function makeMetrics(): BusinessMetricsService {
    return {
      incPromptInvalidResponse: vi.fn(),
    } as unknown as BusinessMetricsService;
  }

  function makeRouterReturning(
    responses: Array<{ text: string; modelUsed?: string }>,
  ): { router: LlmRouterService; capturedCalls: LlmCallParams[] } {
    const capturedCalls: LlmCallParams[] = [];
    let i = 0;
    const router = {
      call: vi.fn(async (params: LlmCallParams) => {
        capturedCalls.push(params);
        const r = responses[i++];
        return {
          text: r?.text ?? '',
          modelUsed: r?.modelUsed ?? 'deepseek:deepseek-v4-flash',
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
          durationMs: 100,
        };
      }),
    } as unknown as LlmRouterService;
    return { router, capturedCalls };
  }

  const input = {
    meetingId: 'm1',
    tenantId: 'org1',
    meeting: { id: 'm1', type: 'sales', title: 'Test' },
    dialog: [
      { speaker: 'A', text: 'привет', startSec: 0, endSec: 1 },
      { speaker: 'B', text: 'здарова', startSec: 1.1, endSec: 2 },
    ],
  };

  const validWrapped = JSON.stringify({
    chapters: [
      { startMs: 0, endMs: 1000, title: 'Введение', summary: null, order: 0 },
      { startMs: 1000, endMs: 2000, title: 'Обсуждение', summary: null, order: 1 },
      { startMs: 2000, endMs: 3000, title: 'Итоги', summary: null, order: 2 },
    ],
  });

  const validBare = JSON.stringify([
    { startMs: 0, endMs: 1000, title: 'Введение', summary: null, order: 0 },
    { startMs: 1000, endMs: 2000, title: 'Обсуждение', summary: null, order: 1 },
    { startMs: 2000, endMs: 3000, title: 'Итоги', summary: null, order: 2 },
  ]);

  it('пробрасывает responseFormat: json_schema strict с CHAPTERS_JSON_SCHEMA', async () => {
    const { router, capturedCalls } = makeRouterReturning([{ text: validWrapped }]);
    const svc = new ChapterExtractionService(router, makeMetrics());

    await svc.extractChapters(input);

    expect(capturedCalls.length).toBe(1);
    expect(capturedCalls[0]?.responseFormat).toEqual({
      type: 'json_schema',
      name: 'chapters_response',
      strict: true,
      schema: CHAPTERS_JSON_SCHEMA,
    });
  });

  it('принимает wrapped { chapters: [...] } (новый формат)', async () => {
    const { router } = makeRouterReturning([{ text: validWrapped }]);
    const svc = new ChapterExtractionService(router, makeMetrics());

    const result = await svc.extractChapters(input);

    expect(result.length).toBe(3);
    expect(result[0]?.title).toBe('Введение');
    expect(result[2]?.order).toBe(2);
  });

  it('принимает bare [...] (legacy провайдер без strict)', async () => {
    const { router } = makeRouterReturning([{ text: validBare }]);
    const svc = new ChapterExtractionService(router, makeMetrics());

    const result = await svc.extractChapters(input);

    expect(result.length).toBe(3);
    expect(result[0]?.title).toBe('Введение');
  });

  it('невалидный JSON → метрика reason=json_parse + ретрай', async () => {
    const metrics = makeMetrics();
    const { router } = makeRouterReturning([
      { text: 'это не JSON', modelUsed: 'deepseek:flash' },
      { text: validWrapped },
    ]);
    const svc = new ChapterExtractionService(router, metrics);

    const result = await svc.extractChapters(input);

    expect(result.length).toBe(3);
    expect(metrics.incPromptInvalidResponse).toHaveBeenCalledWith({
      taskType: 'chapters',
      model: 'deepseek:flash',
      reason: 'json_parse',
    });
  });

  it('JSON не соответствует схеме → метрика reason=schema + ретрай', async () => {
    const metrics = makeMetrics();
    const badSchema = JSON.stringify({
      chapters: [{ wrong_field: 1 }],
    });
    const { router } = makeRouterReturning([
      { text: badSchema, modelUsed: 'deepseek:flash' },
      { text: validWrapped },
    ]);
    const svc = new ChapterExtractionService(router, metrics);

    const result = await svc.extractChapters(input);

    expect(result.length).toBe(3);
    expect(metrics.incPromptInvalidResponse).toHaveBeenCalledWith({
      taskType: 'chapters',
      model: 'deepseek:flash',
      reason: 'schema',
    });
  });

  it('работает без BusinessMetricsService (Optional injection)', async () => {
    const { router } = makeRouterReturning([{ text: validWrapped }]);
    const svc = new ChapterExtractionService(router);

    const result = await svc.extractChapters(input);

    expect(result.length).toBe(3);
  });
});
