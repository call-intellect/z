import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MultiQueryExpansionService } from './multi-query-expansion.service';

describe('MultiQueryExpansionService', () => {
  let llmCallMock: ReturnType<typeof vi.fn>;
  let svc: MultiQueryExpansionService;
  let cfg: {
    dialogLayer: { multiQueryExpansionEnabled: boolean };
    aiFeatures: { promptInjectionGuardEnabled: boolean };
  };

  beforeEach(() => {
    llmCallMock = vi.fn();
    cfg = {
      dialogLayer: { multiQueryExpansionEnabled: true },
      aiFeatures: { promptInjectionGuardEnabled: false },
    };
    svc = new MultiQueryExpansionService(
      { call: llmCallMock } as unknown as never,
      cfg as unknown as never,
      {
        observeDialogProcessingDuration: vi.fn(),
        incPromptInjectionAttempt: vi.fn(),
        incPromptInvalidResponse: vi.fn(),
      } as unknown as never,
    );
  });

  it('org-режим при enabled ВСЕГДА вызывает llm.call (нет intent-гейтинга), даже на factual', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"queries":["q1","q2","q3"]}',
      modelUsed: 'deepseek:deepseek-v4-flash',
    });
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Сколько денег?',
      intent: 'factual',
      conversationId: null,
    });
    expect(llmCallMock).toHaveBeenCalledTimes(1);
    expect(r.expanded).toBe(true);
    expect(r.queries[0]).toBe('Сколько денег?');
    expect(r.queries).toEqual(['Сколько денег?', 'q1', 'q2', 'q3']);
  });

  it('summary + history доходят до промпта (userMessage содержит их текст)', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"queries":["Сколько стоит Маяк?"]}',
      modelUsed: 'deepseek:deepseek-v4-flash',
    });
    await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'а сколько это стоит?',
      intent: 'factual',
      conversationId: 'conv-1',
      summary: 'Обсуждали продукт Маяк для логистики.',
      history: [
        { role: 'user', content: 'Что у нас по продукту Маяк?' },
        { role: 'assistant', content: 'Это система для логистики.' },
      ],
    });
    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'dialog-multi-query',
        userMessage: expect.stringContaining('Обсуждали продукт Маяк для логистики.'),
      }),
    );
    const callArg = llmCallMock.mock.calls[0]?.[0] as { userMessage: string };
    expect(callArg.userMessage).toContain('Что у нас по продукту Маяк?');
    expect(callArg.userMessage).toContain('Это система для логистики.');
    expect(callArg.userMessage).toContain('а сколько это стоит?');
  });

  it('clone-режим использует clone-промпт и taskType dialog-multi-query-clone', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"queries":["точная","аналог","принцип"]}',
      modelUsed: 'deepseek:deepseek-v4-pro',
    });
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Как бы поступил клон маркетолога?',
      intent: 'factual',
      conversationId: null,
      mode: 'clone',
    });
    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'dialog-multi-query-clone' }),
    );
    expect(r.expanded).toBe(true);
  });

  it('disabled flag — НЕ expand, llm не вызывается', async () => {
    cfg.dialogLayer.multiQueryExpansionEnabled = false;
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Расскажи про найм',
      intent: 'exploratory',
      conversationId: null,
    });
    expect(r.expanded).toBe(false);
    expect(r.queries).toEqual(['Расскажи про найм']);
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('LLM упал → queries=[question], expanded=false', async () => {
    llmCallMock.mockRejectedValue(new Error('LLM timeout'));
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Расскажи про найм',
      intent: 'exploratory',
      conversationId: null,
    });
    expect(r.queries).toEqual(['Расскажи про найм']);
    expect(r.expanded).toBe(false);
  });

  it('дедуп оригинала с экспансиями (если LLM повторил реплику)', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"queries":["Расскажи про найм","Какова ситуация с подбором?","Найм инженеров"]}',
      modelUsed: 'deepseek:deepseek-v4-flash',
    });
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Расскажи про найм',
      intent: 'exploratory',
      conversationId: null,
    });
    expect(r.queries).toEqual([
      'Расскажи про найм',
      'Какова ситуация с подбором?',
      'Найм инженеров',
    ]);
  });
});
