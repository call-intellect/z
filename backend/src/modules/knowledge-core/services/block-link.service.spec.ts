import { beforeEach, describe, expect, it, vi } from 'vitest';

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
