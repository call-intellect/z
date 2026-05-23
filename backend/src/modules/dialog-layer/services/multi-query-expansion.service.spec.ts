import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MultiQueryExpansionService } from './multi-query-expansion.service';

/**
 * SBA α-5 dialog-layer — unit-тесты MultiQueryExpansionService.
 */
describe('MultiQueryExpansionService', () => {
  let llmCallMock: ReturnType<typeof vi.fn>;
  let svc: MultiQueryExpansionService;
  let cfg: { dialogLayer: { multiQueryExpansionEnabled: boolean } };

  beforeEach(() => {
    llmCallMock = vi.fn();
    cfg = { dialogLayer: { multiQueryExpansionEnabled: true } };
    svc = new MultiQueryExpansionService(
      { call: llmCallMock } as unknown as never,
      cfg as unknown as never,
      { observeDialogProcessingDuration: vi.fn() } as unknown as never,
    );
  });

  it('factual intent — НЕ expand (gating)', async () => {
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Сколько денег?',
      intent: 'factual',
      conversationId: null,
    });
    expect(r.expanded).toBe(false);
    expect(r.queries).toEqual(['Сколько денег?']);
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('exploratory intent — 3 expansion (originalQuestion + 3)', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"queries": ["Расскажи о найме разработчиков", "Какая ситуация с подбором инженеров?", "Найм senior-разработчиков в 2026"]}',
    });
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Расскажи про найм',
      intent: 'exploratory',
      conversationId: null,
    });
    expect(r.expanded).toBe(true);
    expect(r.queries.length).toBeGreaterThan(1);
    expect(r.queries[0]).toBe('Расскажи про найм'); // оригинал первый
  });

  it('analytical intent — тоже expand', async () => {
    llmCallMock.mockResolvedValue({
      text: '{"queries": ["q1", "q2", "q3"]}',
    });
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Почему мы теряем клиентов?',
      intent: 'analytical',
      conversationId: null,
    });
    expect(r.expanded).toBe(true);
  });

  it('disabled flag — НЕ expand', async () => {
    cfg.dialogLayer.multiQueryExpansionEnabled = false;
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Расскажи про найм',
      intent: 'exploratory',
      conversationId: null,
    });
    expect(r.expanded).toBe(false);
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('LLM error → возвращаем только оригинальный вопрос', async () => {
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

  it('clone_roleplay intent — НЕ expand', async () => {
    const r = await svc.expand({
      tenantId: 't',
      userId: 'u',
      question: 'Как бы Иван сказал?',
      intent: 'clone_roleplay',
      conversationId: null,
    });
    expect(r.expanded).toBe(false);
  });
});
