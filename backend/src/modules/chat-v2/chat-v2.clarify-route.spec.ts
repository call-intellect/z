import { describe, expect, it, vi } from 'vitest';

import { ChatV2OrchestrationService } from './chat-v2.service';

function makeHarness(clarification: unknown) {
  const cfg = {
    chatV2: { defaultMode: 'synthetic', historyMessages: 6 },
    getDynamic: vi.fn(async () => 'on'),
  } as unknown;

  const prisma = {
    chatV2Conversation: { findUnique: vi.fn(async () => ({ summary: null })) },
    chatV2Message: { findMany: vi.fn(async () => []) },
    ideaBlock: { findMany: vi.fn(async () => []) },
  } as unknown;

  const conversations = {
    create: vi.fn(async () => ({ id: 'conv-1', channelKindOrigin: null })),
    getById: vi.fn(async () => ({ id: 'conv-1', channelKindOrigin: null })),
    appendMessage: vi.fn(async () => ({ id: 'msg-1' })),
    generateTitle: vi.fn(async () => undefined),
  } as unknown;

  const synthesize = vi.fn(async () => {
    throw new Error('synthesis НЕ должен вызываться при clarification');
  });
  const synthesis = { synthesize } as unknown;

  const metrics = {
    observeChatV2SynthesisDuration: vi.fn(),
    incChatV2Query: vi.fn(),
    observeChatV2RetrievalBlocks: vi.fn(),
    incChatV2NoEvidence: vi.fn(),
    incChatV2UncertaintyMarked: vi.fn(),
    incRagAbstain: vi.fn(),
  } as unknown;

  const dialog = {
    process: vi.fn(async () => ({
      enabled: true,
      standaloneQuestion: 'какие встречи с Александром',
      intent: 'factual',
      queryClass: 'list',
      queryClassConfidence: 0.9,
      queries: ['какие встречи с Александром'],
      confidence: 1,
      cachedAnswer: null,
      queryPlan: null,
      structuralFilters: null,
      clarification,
      steps: {},
    })),
  } as unknown;

  const answerCacheSet = vi.fn(async () => undefined);
  const answerCache = { set: answerCacheSet } as unknown;

  const llmCall = vi.fn(async () => ({ text: '{"grounded":true,"reason":""}' }));
  const llm = { call: llmCall } as unknown;

  const service = new ChatV2OrchestrationService(
    prisma as never,
    cfg as never,
    conversations as never,
    synthesis as never,
    metrics as never,
    dialog as never,
    answerCache as never,
    llm as never,
  );
  return { service, synthesize, llmCall, answerCacheSet };
}

describe('ChatV2OrchestrationService.ask — К1 clarify-короткозамыкание (Ф4 R14)', () => {
  it('dialog.clarification → needsClarification:true, текст вопроса, synthesis НЕ вызван', async () => {
    const h = makeHarness({
      question: 'Уточните, про какого «Александр» речь?',
      hint: 'Александр',
      candidatePersonIds: ['A1', 'A2'],
    });

    const answer = await h.service.ask({
      tenantId: 't1',
      userId: 'u1',
      question: 'какие встречи с Александром',
    });

    expect(answer.needsClarification).toBe(true);
    expect(answer.text).toContain('Александр');
    expect(h.synthesize).not.toHaveBeenCalled();
    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.answerCacheSet).not.toHaveBeenCalled();
  });

  it('clarification:null → идёт в синтез (короткого замыкания нет)', async () => {
    const h = makeHarness(null);
    h.synthesize.mockResolvedValue({
      text: 'Ответ [BLOCK:b1].',
      citations: [],
      retrievalMeta: { usedBlockIds: ['b1'] },
      llmMeta: { model: 'm', inputTokens: 1, outputTokens: 1 },
      uncertaintyNote: null,
      dataClass: 'internal',
      needsClarification: false,
    } as never);

    const answer = await h.service.ask({
      tenantId: 't1',
      userId: 'u1',
      question: 'какие встречи с Александром',
    });

    expect(answer.needsClarification).toBe(false);
    expect(h.synthesize).toHaveBeenCalledTimes(1);
  });
});
