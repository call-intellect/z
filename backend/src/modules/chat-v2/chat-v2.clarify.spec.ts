import { describe, expect, it, vi } from 'vitest';

import { ChatV2OrchestrationService } from './chat-v2.service';
import type { SynthesisResult } from './services/synthesis.service';

const CLARIFY_GOLDEN: SynthesisResult = {
  text:
    'В памяти есть несколько разных встреч с Александром:\n' +
    '- Встреча по бюджету [BLOCK:aaa111].\n' +
    '- Встреча по найму [BLOCK:bbb222].\n' +
    'Какую из них вы имеете в виду?',
  citations: [],
  retrievalMeta: { usedBlockIds: ['aaa111', 'bbb222'] },
  llmMeta: { model: 'deepseek', inputTokens: 1, outputTokens: 1 },
  uncertaintyNote: null,
  dataClass: 'internal',
  needsClarification: true,
};

const NORMAL_GOLDEN: SynthesisResult = {
  text: 'Бюджет согласовали в полном объёме [BLOCK:aaa111].',
  citations: [],
  retrievalMeta: { usedBlockIds: ['aaa111'] },
  llmMeta: { model: 'deepseek', inputTokens: 1, outputTokens: 1 },
  uncertaintyNote: null,
  dataClass: 'internal',
  needsClarification: false,
};

interface Harness {
  service: ChatV2OrchestrationService;
  llmCall: ReturnType<typeof vi.fn>;
  answerCacheSet: ReturnType<typeof vi.fn>;
  synthesize: ReturnType<typeof vi.fn>;
}

function makeHarness(synthesisResult: SynthesisResult): Harness {
  const cfg = {
    chatV2: { defaultMode: 'synthetic', historyMessages: 6 },
    getDynamic: vi.fn(async () => 'on'),
  } as unknown;

  const prisma = {
    chatV2Conversation: {
      findUnique: vi.fn(async () => ({ summary: null })),
    },
    chatV2Message: { findMany: vi.fn(async () => []) },
    ideaBlock: {
      findMany: vi.fn(async () => [
        { id: 'aaa111', name: 'Блок', trustedAnswer: 'Содержимое' },
      ]),
    },
  } as unknown;

  const conversations = {
    create: vi.fn(async () => ({
      id: 'conv-1',
      channelKindOrigin: null,
    })),
    getById: vi.fn(async () => ({ id: 'conv-1', channelKindOrigin: null })),
    appendMessage: vi.fn(async () => ({ id: 'msg-1' })),
    generateTitle: vi.fn(async () => undefined),
  } as unknown;

  const synthesize = vi.fn(async () => synthesisResult);
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
      standaloneQuestion: 'Что решили с Александром?',
      intent: 'factual',
      queries: ['Что решили с Александром?'],
      confidence: 1,
      cachedAnswer: null,
      queryPlan: null,
      structuralFilters: null,
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

  return { service, llmCall, answerCacheSet, synthesize };
}

const baseInput = {
  tenantId: 't1',
  userId: 'u1',
  question: 'Что решили на встрече с Александром?',
};

describe('ChatV2OrchestrationService.ask — clarify-петля (Ф3)', () => {
  it('needsClarification:true → гейт заземления НЕ вызван, answerCache НЕ записан, флаг проброшен', async () => {
    const h = makeHarness(CLARIFY_GOLDEN);

    const answer = await h.service.ask({ ...baseInput });

    expect(answer).toEqual(
      expect.objectContaining({ needsClarification: true }),
    );
    expect(answer.text).toBe(CLARIFY_GOLDEN.text);
    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.answerCacheSet).not.toHaveBeenCalled();
  });

  it('needsClarification:false → гейт заземления вызван (1 llm.call), answerCache записан', async () => {
    const h = makeHarness(NORMAL_GOLDEN);

    const answer = await h.service.ask({ ...baseInput });

    expect(answer).toEqual(
      expect.objectContaining({ needsClarification: false }),
    );
    expect(h.llmCall).toHaveBeenCalledTimes(1);
    expect(h.answerCacheSet).toHaveBeenCalledTimes(1);
  });
});
