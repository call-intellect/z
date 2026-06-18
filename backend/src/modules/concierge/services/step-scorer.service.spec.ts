import { describe, expect, it, vi } from 'vitest';

import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { ConciergeStepScorerService, type StepCandidate } from './step-scorer.service';

function buildScorer(args: { llmCall: ReturnType<typeof vi.fn> }): ConciergeStepScorerService {
  const llm = { call: args.llmCall } as unknown as LlmRouterService;
  return new ConciergeStepScorerService(llm);
}

const baseCandidate: StepCandidate = {
  toolName: 'search_meetings',
  args: { from: '2026-05-31', to: '2026-05-31' },
};

const baseArgs = {
  goal: 'Сколько встреч на завтра?',
  history: [
    { role: 'user', content: 'привет' },
    { role: 'assistant', content: 'добрый день' },
  ],
  retrievedContext: [{ id: 'm1', title: 'Демо' }],
  tenantId: 'tenant-1',
};

describe('ConciergeStepScorerService.scoreStep', () => {
  it('(1) single candidate → score в [0,1] + reasoning из LLM', async () => {
    const llmCall = vi.fn(async () => ({
      text: '{"score": 0.82, "reasoning": "Подходит для запроса о встречах"}',
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 100,
      outputTokens: 30,
      cachedTokens: 90,
      durationMs: 200,
    }));
    const scorer = buildScorer({ llmCall });

    const result = await scorer.scoreStep({
      ...baseArgs,
      candidate: baseCandidate,
    });

    expect(result.candidate).toBe(baseCandidate);
    expect(result.score).toBeCloseTo(0.82);
    expect(result.reasoning).toBe('Подходит для запроса о встречах');
    expect(llmCall).toHaveBeenCalledTimes(1);
    const callArgs = (llmCall.mock.calls[0] as unknown as unknown[]) ?? [];
    const call = (callArgs[0] ?? {}) as {
      taskType: string;
      tenantId: string;
      responseFormat?: { type: string; name: string };
    };
    expect(call.taskType).toBe('concierge-step-prm');
    expect(call.tenantId).toBe('tenant-1');
    expect(call.responseFormat?.type).toBe('json_schema');
    expect(call.responseFormat?.name).toBe('concierge_step_prm_v1');
  });

  it('(3) LLM провайдер падает → fallback score=0, без throw', async () => {
    const llmCall = vi.fn(async () => {
      throw new Error('all providers failed');
    });
    const scorer = buildScorer({ llmCall });

    const result = await scorer.scoreStep({
      ...baseArgs,
      candidate: baseCandidate,
    });

    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('PRM провайдер недоступен');
  });

  it('(4) невалидный JSON → fallback score=0', async () => {
    const llmCall = vi.fn(async () => ({
      text: 'это не JSON а просто текст',
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 100,
      outputTokens: 10,
      cachedTokens: 0,
      durationMs: 100,
    }));
    const scorer = buildScorer({ llmCall });

    const result = await scorer.scoreStep({
      ...baseArgs,
      candidate: baseCandidate,
    });

    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('невалидный JSON');
  });

  it('(5) score за пределами [0,1] — клампится', async () => {
    const llmCall = vi.fn(async () => ({
      text: '{"score": 1.5, "reasoning": "out of range"}',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    }));
    const scorer = buildScorer({ llmCall });
    const result = await scorer.scoreStep({
      ...baseArgs,
      candidate: baseCandidate,
    });
    expect(result.score).toBe(1);

    const llmCall2 = vi.fn(async () => ({
      text: '{"score": -0.5, "reasoning": "negative"}',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    }));
    const scorer2 = buildScorer({ llmCall: llmCall2 });
    const result2 = await scorer2.scoreStep({
      ...baseArgs,
      candidate: baseCandidate,
    });
    expect(result2.score).toBe(0);
  });

  it('(6) пустой reasoning → fallback-строка', async () => {
    const llmCall = vi.fn(async () => ({
      text: '{"score": 0.5, "reasoning": ""}',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    }));
    const scorer = buildScorer({ llmCall });
    const result = await scorer.scoreStep({
      ...baseArgs,
      candidate: baseCandidate,
    });
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toBe('PRM не вернул внятного reasoning.');
  });
});

describe('ConciergeStepScorerService.scoreAllCandidates', () => {
  it('(2) top-3 кандидата → 3 scores параллельно, порядок сохранён', async () => {
    let callIdx = 0;
    const scores = [0.9, 0.4, 0.7];
    const llmCall = vi.fn(async () => {
      const score = scores[callIdx++ % scores.length];
      return {
        text: `{"score": ${score}, "reasoning": "score ${score}"}`,
        modelUsed: 'mock',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        durationMs: 0,
      };
    });
    const scorer = buildScorer({ llmCall });

    const candidates: StepCandidate[] = [
      { toolName: 'tool_a', args: { x: 1 } },
      { toolName: 'tool_b', args: { x: 2 } },
      { toolName: 'tool_c', args: { x: 3 } },
    ];
    const results = await scorer.scoreAllCandidates({
      ...baseArgs,
      candidates,
    });

    expect(results).toHaveLength(3);
    expect(results[0]?.candidate.toolName).toBe('tool_a');
    expect(results[0]?.score).toBeCloseTo(0.9);
    expect(results[1]?.candidate.toolName).toBe('tool_b');
    expect(results[1]?.score).toBeCloseTo(0.4);
    expect(results[2]?.candidate.toolName).toBe('tool_c');
    expect(results[2]?.score).toBeCloseTo(0.7);
    expect(llmCall).toHaveBeenCalledTimes(3);
  });

  it('пустой массив кандидатов → пустой результат, LLM не вызывается', async () => {
    const llmCall = vi.fn();
    const scorer = buildScorer({ llmCall });
    const results = await scorer.scoreAllCandidates({
      ...baseArgs,
      candidates: [],
    });
    expect(results).toEqual([]);
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('один кандидат падает, другие — нет: возвращает массив с fallback для упавшего', async () => {
    let callIdx = 0;
    const llmCall = vi.fn(async () => {
      callIdx++;
      if (callIdx === 2) throw new Error('provider down');
      return {
        text: '{"score": 0.7, "reasoning": "ok"}',
        modelUsed: 'mock',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        durationMs: 0,
      };
    });
    const scorer = buildScorer({ llmCall });

    const candidates: StepCandidate[] = [
      { toolName: 'a', args: {} },
      { toolName: 'b', args: {} },
      { toolName: 'c', args: {} },
    ];
    const results = await scorer.scoreAllCandidates({
      ...baseArgs,
      candidates,
    });
    expect(results).toHaveLength(3);
    expect(results[0]?.score).toBeCloseTo(0.7);
    expect(results[1]?.score).toBe(0);
    expect(results[1]?.reasoning).toContain('PRM провайдер недоступен');
    expect(results[2]?.score).toBeCloseTo(0.7);
  });
});
