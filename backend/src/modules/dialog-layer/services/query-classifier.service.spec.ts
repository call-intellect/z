import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DIALOG_CLASSIFY_JSON_SCHEMA } from '../prompts/classify.prompt';

import {
  classifyQueryClass,
  QueryClassifierService,
  type DialogIntent,
  type QueryClass,
} from './query-classifier.service';

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

  it('skipHeuristicFirstPass=true → эвристика не срабатывает, идёт в LLM', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"intent": "daily_plan_morning", "confidence": 0.92}',
      modelUsed: 'deepseek:flash',
    });
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Сегодня хочу закрыть КП и созвониться. Сколько времени уйдёт?',
      conversationId: null,
      skipHeuristicFirstPass: true,
    });
    expect(result.intent).toBe('daily_plan_morning');
    expect(result.confidence).toBe(0.92);
    expect(result.source).toBe('llm');
    expect(llmCallMock).toHaveBeenCalledOnce();
  });

  it('LLM возвращает note с confidence 0.5 → intent=note, confidence=0.5', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"intent": "note", "confidence": 0.5}',
      modelUsed: 'deepseek:flash',
    });
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Сегодня какое-то размытое сообщение',
      conversationId: null,
      skipHeuristicFirstPass: true,
    });
    expect(result.intent).toBe('note');
    expect(result.confidence).toBe(0.5);
  });

  it('alias: LLM возвращает "plan" → нормализуется в daily_plan_morning', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"intent": "plan", "confidence": 0.9}',
      modelUsed: 'deepseek:flash',
    });
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'на сегодня А Б В',
      conversationId: null,
      skipHeuristicFirstPass: true,
    });
    expect(result.intent).toBe('daily_plan_morning');
  });

  it('LLM упал + текст «План на день: ...» → fallback_heuristic morning', async () => {
    llmCallMock.mockRejectedValue(new Error('all providers exhausted'));
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'План на день: КП, созвон, отчёт',
      conversationId: null,
      skipHeuristicFirstPass: true,
    });
    expect(result.intent).toBe('daily_plan_morning');
    expect(result.source).toBe('fallback_heuristic');
    expect(result.confidence).toBeNull();
  });

  it('LLM упал + текст «Итоги дня: ...» → fallback_heuristic evening', async () => {
    llmCallMock.mockRejectedValue(new Error('timeout'));
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Итоги дня: КП отправил, остальное не успел',
      conversationId: null,
      skipHeuristicFirstPass: true,
    });
    expect(result.intent).toBe('daily_report_evening');
    expect(result.source).toBe('fallback_heuristic');
  });

  it('LLM упал + текст без триггеров → factual+fallback (legacy поведение)', async () => {
    llmCallMock.mockRejectedValue(new Error('LLM error'));
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Какое-то случайное сообщение без триггеров',
      conversationId: null,
      skipHeuristicFirstPass: true,
    });
    expect(result.intent).toBe('factual');
    expect(result.source).toBe('fallback');
  });

  // ─── ТЗ 2026-06-17 probe-system-phase2 Ф1 — интент probe_reply ────────
  it('openProbeQuestion + ответ по сути + LLM probe_reply(0.8) → intent probe_reply', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"intent": "probe_reply", "confidence": 0.8}',
      modelUsed: 'deepseek:flash',
    });
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Да, отвечает Иванов',
      conversationId: null,
      openProbeQuestion: 'Кто отвечает за это решение?',
    });
    expect(result.intent).toBe('probe_reply');
    expect(result.confidence).toBe(0.8);
    expect(result.source).toBe('llm');
    // openProbeQuestion подставлен в КОНЕЦ USER-промпта (cache-friendly).
    expect(llmCallMock).toHaveBeenCalledOnce();
    const callArg = llmCallMock.mock.calls[0]?.[0] as { userMessage?: string };
    expect(callArg.userMessage).toContain('Открытый вопрос Коры тебе сейчас');
    expect(callArg.userMessage).toContain('Кто отвечает за это решение?');
  });

  it('БЕЗ openProbeQuestion (LLM вернул обычный интент) → НЕ probe_reply', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"intent": "note", "confidence": 0.7}',
      modelUsed: 'deepseek:flash',
    });
    const result = await svc.classify({
      tenantId: 't',
      userId: 'u',
      question: 'Иванов',
      conversationId: null,
      skipHeuristicFirstPass: true,
    });
    expect(result.intent).not.toBe('probe_reply');
    expect(result.intent).toBe('note');
    // Без openProbeQuestion блок в USER не добавляется.
    const callArg = llmCallMock.mock.calls[0]?.[0] as { userMessage?: string };
    expect(callArg.userMessage).not.toContain('Открытый вопрос Коры тебе сейчас');
  });
});

describe('classifyQueryClass — детерминированный роутер 5 классов (Ф3)', () => {
  const cases: Array<{ q: string; expected: QueryClass }> = [
    { q: 'какие встречи с Ивановым', expected: 'list' },
    { q: 'все встречи где обсуждали бюджет', expected: 'list' },
    { q: 'покажи все задачи по проекту', expected: 'list' },
    { q: 'с кем встречались на прошлой неделе', expected: 'list' },
    { q: 'документы про логистику', expected: 'list' },
    { q: 'итоги за месяц', expected: 'temporal' },
    { q: 'как прошла неделя у отдела продаж', expected: 'temporal' },
    { q: 'результаты за квартал', expected: 'temporal' },
    { q: 'что у нас по продажам', expected: 'overview' },
    { q: 'обзор по маркетингу', expected: 'overview' },
    { q: 'как дела с продуктом', expected: 'overview' },
    { q: 'что решили по бюджету', expected: 'fact' },
    { q: 'когда следующая встреча', expected: 'fact' },
    { q: 'сколько стоит лицензия', expected: 'fact' },
    { q: 'какой статус задачи по найму', expected: 'fact' },
    { q: 'обсуждали реструктуризацию', expected: 'topic' },
    { q: 'что говорили про найм инженеров', expected: 'topic' },
  ];

  for (const { q, expected } of cases) {
    it(`«${q}» → ${expected}`, () => {
      expect(classifyQueryClass(q).class).toBe(expected);
    });
  }

  it('уверенный regex-match даёт высокую уверенность (≥0.7)', () => {
    expect(classifyQueryClass('какие встречи с Ивановым').confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('дефолтный topic при отсутствии паттерна → низкая уверенность (<0.6)', () => {
    const r = classifyQueryClass('хм непонятная фраза без ключевых слов');
    expect(r.class).toBe('topic');
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('пустой/нестроковый вход → topic, не падает', () => {
    expect(classifyQueryClass('').class).toBe('topic');
    expect(classifyQueryClass(undefined as unknown as string).class).toBe('topic');
  });
});
