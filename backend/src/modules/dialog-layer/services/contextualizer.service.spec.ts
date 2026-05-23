import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ContextualizerService } from './contextualizer.service';

describe('ContextualizerService', () => {
  let llmCallMock: ReturnType<typeof vi.fn>;
  let svc: ContextualizerService;

  beforeEach(() => {
    llmCallMock = vi.fn();
    svc = new ContextualizerService(
      { call: llmCallMock } as unknown as never,
      { observeDialogProcessingDuration: vi.fn() } as unknown as never,
    );
  });

  it('пустой контекст → no-op (LLM не вызывается)', async () => {
    const r = await svc.contextualize({
      tenantId: 't',
      userId: 'u',
      question: 'Какой бюджет?',
      summary: null,
      history: [],
      conversationId: null,
    });
    expect(r.standaloneQuestion).toBe('Какой бюджет?');
    expect(r.llmCalled).toBe(false);
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('есть history → LLM вызывается + результат возвращается', async () => {
    llmCallMock.mockResolvedValue({
      text: 'Сколько стоит продукт X?',
    });
    const r = await svc.contextualize({
      tenantId: 't',
      userId: 'u',
      question: 'А сколько стоит?',
      summary: null,
      history: [
        { role: 'user', content: 'Расскажи про продукт X' },
        { role: 'assistant', content: 'Продукт X — это...' },
      ],
      conversationId: 'c1',
    });
    expect(r.standaloneQuestion).toBe('Сколько стоит продукт X?');
    expect(r.llmCalled).toBe(true);
    expect(llmCallMock).toHaveBeenCalledOnce();
  });

  it('LLM error → fallback на raw userMessage', async () => {
    llmCallMock.mockRejectedValue(new Error('LLM timeout'));
    const r = await svc.contextualize({
      tenantId: 't',
      userId: 'u',
      question: 'А сколько стоит?',
      summary: 'Обсуждали продукт X — это новинка.',
      history: [],
      conversationId: 'c1',
    });
    expect(r.standaloneQuestion).toBe('А сколько стоит?');
    expect(r.llmCalled).toBe(false);
  });

  it('summary без history тоже вызывает LLM', async () => {
    llmCallMock.mockResolvedValue({ text: 'standalone' });
    const r = await svc.contextualize({
      tenantId: 't',
      userId: 'u',
      question: 'А что дальше?',
      summary: 'Обсуждали roadmap.',
      history: [],
      conversationId: 'c1',
    });
    expect(r.llmCalled).toBe(true);
  });
});
