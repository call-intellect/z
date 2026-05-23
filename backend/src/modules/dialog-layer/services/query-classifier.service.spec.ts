import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  QueryClassifierService,
  type DialogIntent,
} from './query-classifier.service';

/**
 * SBA α-5 dialog-layer — unit-тесты QueryClassifierService.
 *
 * Покрывает: эвристика matches (factual / exploratory / analytical /
 * clone_roleplay) — БЕЗ LLM-вызова; LLM-fallback при отсутствии паттерна.
 */
describe('QueryClassifierService', () => {
  let llmCallMock: ReturnType<typeof vi.fn>;
  let observeMock: ReturnType<typeof vi.fn>;
  let svc: QueryClassifierService;

  beforeEach(() => {
    llmCallMock = vi.fn();
    observeMock = vi.fn();
    svc = new QueryClassifierService(
      { call: llmCallMock } as unknown as never,
      {
        observeDialogProcessingDuration: observeMock,
      } as unknown as never,
    );
  });

  async function classify(question: string): Promise<DialogIntent> {
    const r = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question,
      conversationId: null,
    });
    return r.intent;
  }

  it('эвристика: "Сколько X?" → factual без LLM', async () => {
    const intent = await classify('Сколько денег на маркетинг?');
    expect(intent).toBe('factual');
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('эвристика: "Расскажи про X" → exploratory', async () => {
    const intent = await classify('Расскажи про найм инженеров');
    expect(intent).toBe('exploratory');
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('эвристика: "Почему X?" → analytical', async () => {
    const intent = await classify('Почему мы теряем клиентов?');
    expect(intent).toBe('analytical');
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('эвристика: "Как бы Иван сказал" → clone_roleplay', async () => {
    const intent = await classify('Как бы Иван сказал про эту проблему?');
    expect(intent).toBe('clone_roleplay');
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('LLM fallback при отсутствии паттерна', async () => {
    llmCallMock.mockResolvedValue({ text: '{"intent": "exploratory"}' });
    const intent = await classify('Хочу обсудить нашу стратегию на 2026');
    expect(intent).toBe('exploratory');
    expect(llmCallMock).toHaveBeenCalledOnce();
  });

  it('LLM error → fallback на factual', async () => {
    llmCallMock.mockRejectedValue(new Error('LLM timeout'));
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Странный вопрос без ключевых слов',
      conversationId: null,
    });
    expect(result.intent).toBe('factual');
    expect(result.source).toBe('fallback');
  });
});
