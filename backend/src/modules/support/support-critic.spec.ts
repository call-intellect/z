import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportAnswerCriticService } from './services/support-answer-critic.service';

/**
 * support-desk Ф3 — unit-тесты SupportAnswerCriticService.check:
 *   - groundedness < threshold, но модель сказала answer → понижаем до clarify
 *     (DEFENSIVE);
 *   - LLM упал / непарсимый JSON → fail-safe { verdict: escalate,
 *     groundedness: 0 } (отдаём человеку).
 *
 * Зависимости (llm / cfg) замоканы.
 */
describe('SupportAnswerCriticService.check', () => {
  const TENANT = 'vendor-org-1';
  const BLOCKS = [
    { id: 'b1', criticalQuestion: 'q', trustedAnswer: 'a' },
  ];

  let llmStub: { call: ReturnType<typeof vi.fn> };
  let cfgStub: { getDynamic: ReturnType<typeof vi.fn> };
  let svc: SupportAnswerCriticService;

  beforeEach(() => {
    llmStub = { call: vi.fn() };
    // Порог обоснованности 0.6.
    cfgStub = { getDynamic: vi.fn(async () => 0.6) };
    svc = new SupportAnswerCriticService(
      llmStub as unknown as never,
      cfgStub as unknown as never,
    );
  });

  it('groundedness ниже порога + verdict=answer → понижаем до clarify', async () => {
    llmStub.call.mockResolvedValue({
      text: JSON.stringify({
        totalClaims: 5,
        supportedClaims: 1,
        groundedness: 0.2,
        verdict: 'answer',
        unsupported: ['нечто'],
      }),
      modelUsed: 'deepseek:deepseek-v4-flash',
    });

    const res = await svc.check({
      tenantId: TENANT,
      answer: 'ответ',
      contourBlocks: BLOCKS,
    });

    expect(res.verdict).toBe('clarify');
    expect(res.groundedness).toBeCloseTo(0.2, 5);
  });

  it('LLM бросает → fail-safe { verdict: escalate, groundedness: 0 }', async () => {
    llmStub.call.mockRejectedValue(new Error('boom'));

    const res = await svc.check({
      tenantId: TENANT,
      answer: 'ответ',
      contourBlocks: BLOCKS,
    });

    expect(res).toEqual({ groundedness: 0, verdict: 'escalate', unsupported: [] });
  });

  it('непарсимый JSON → fail-safe escalate', async () => {
    llmStub.call.mockResolvedValue({
      text: 'не json',
      modelUsed: 'deepseek:deepseek-v4-flash',
    });

    const res = await svc.check({
      tenantId: TENANT,
      answer: 'ответ',
      contourBlocks: BLOCKS,
    });

    expect(res).toEqual({ groundedness: 0, verdict: 'escalate', unsupported: [] });
  });
});
