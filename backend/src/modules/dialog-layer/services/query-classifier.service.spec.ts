import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DIALOG_CLASSIFY_JSON_SCHEMA } from '../prompts/classify.prompt';

import {
  QueryClassifierService,
  type DialogIntent,
} from './query-classifier.service';

/**
 * SBA α-5 dialog-layer — unit-тесты QueryClassifierService.
 *
 * Покрывает: эвристика matches (factual / exploratory / analytical /
 * clone_roleplay) — БЕЗ LLM-вызова; LLM-fallback при отсутствии паттерна.
 * T7-F6: проверка responseFormat:json_schema проброса + метрика.
 */
describe('QueryClassifierService', () => {
  let llmCallMock: ReturnType<typeof vi.fn>;
  let observeMock: ReturnType<typeof vi.fn>;
  let incPromptInjectionAttempt: ReturnType<typeof vi.fn>;
  let incPromptInvalidResponse: ReturnType<typeof vi.fn>;
  let svc: QueryClassifierService;

  beforeEach(() => {
    llmCallMock = vi.fn();
    observeMock = vi.fn();
    incPromptInjectionAttempt = vi.fn();
    incPromptInvalidResponse = vi.fn();
    svc = new QueryClassifierService(
      { call: llmCallMock } as unknown as never,
      {
        observeDialogProcessingDuration: observeMock,
        incPromptInjectionAttempt,
        incPromptInvalidResponse,
      } as unknown as never,
      { aiFeatures: { promptInjectionGuardEnabled: true } } as unknown as never,
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
    llmCallMock.mockResolvedValue({
      text: '{"intent": "exploratory"}',
      modelUsed: 'deepseek:flash',
    });
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

  // ─── T7-F6 ───────────────────────────────────────────────────────────────
  it('T7-F6: пробрасывает responseFormat: json_schema strict в LlmRouter', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"intent": "factual"}',
      modelUsed: 'deepseek:flash',
    });
    await classify('Странный вопрос без ключевых слов');

    expect(llmCallMock).toHaveBeenCalledOnce();
    const callArg = llmCallMock.mock.calls[0]?.[0] as {
      responseFormat?: unknown;
    };
    expect(callArg.responseFormat).toEqual({
      type: 'json_schema',
      name: 'dialog_classify_response',
      strict: true,
      schema: DIALOG_CLASSIFY_JSON_SCHEMA,
    });
  });

  it('T7-F6: невалидный JSON-ответ → метрика z_prompt_invalid_response_total + fallback factual', async () => {
    llmCallMock.mockResolvedValue({
      text: 'not a json',
      modelUsed: 'deepseek:flash',
    });
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Странный вопрос без ключевых слов',
      conversationId: null,
    });
    expect(result.intent).toBe('factual');
    expect(incPromptInvalidResponse).toHaveBeenCalledWith({
      taskType: 'dialog-classify',
      model: 'deepseek:flash',
      reason: 'json_parse',
    });
  });
});
