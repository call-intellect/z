import { describe, expect, it, vi } from 'vitest';

import { ChatV2OrchestrationService } from './chat-v2.service';
import type { SynthesisResult } from './services/synthesis.service';

const NORMAL_GOLDEN: SynthesisResult = {
  text: 'Бюджет согласовали в полном объёме [BLOCK:aaa111].',
  citations: [],
  retrievalMeta: { usedBlockIds: ['aaa111'] },
  llmMeta: { model: 'deepseek', inputTokens: 1, outputTokens: 1 },
  uncertaintyNote: null,
  dataClass: 'internal',
  needsClarification: false,
  answerKind: 'prose',
};

const CLARIFY_GOLDEN: SynthesisResult = {
  text: 'Есть несколько встреч с Александром — какую вы имеете в виду?',
  citations: [],
  retrievalMeta: { usedBlockIds: ['aaa111', 'bbb222'] },
  llmMeta: { model: 'deepseek', inputTokens: 1, outputTokens: 1 },
  uncertaintyNote: null,
  dataClass: 'internal',
  needsClarification: true,
  answerKind: 'prose',
};

interface Harness {
  service: ChatV2OrchestrationService;
  llmCall: ReturnType<typeof vi.fn>;
  answerCacheSet: ReturnType<typeof vi.fn>;
  synthesize: ReturnType<typeof vi.fn>;
  conversationsCreate: ReturnType<typeof vi.fn>;
  appendMessage: ReturnType<typeof vi.fn>;
  generateTitle: ReturnType<typeof vi.fn>;
  dialogProcess: ReturnType<typeof vi.fn>;
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

  const conversationsCreate = vi.fn(async () => ({
    id: 'conv-1',
    channelKindOrigin: null,
  }));
  const appendMessage = vi.fn(async () => ({ id: 'msg-1' }));
  const generateTitle = vi.fn(async () => undefined);
  const conversations = {
    create: conversationsCreate,
    getById: vi.fn(async () => ({ id: 'conv-1', channelKindOrigin: null })),
    appendMessage,
    generateTitle,
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

  const dialogProcess = vi.fn(async () => ({
    enabled: true,
    standaloneQuestion: 'Что решили с Александром?',
    intent: 'factual',
    queries: ['Что решили с Александром?'],
    confidence: 1,
    cachedAnswer: null,
    queryPlan: null,
    structuralFilters: null,
    steps: {},
  }));
  const dialog = { process: dialogProcess } as unknown;

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

  return {
    service,
    llmCall,
    answerCacheSet,
    synthesize,
    conversationsCreate,
    appendMessage,
    generateTitle,
    dialogProcess,
  };
}

const baseInput = {
  tenantId: 't1',
  userId: 'u1',
  question: 'Что решили на встрече с Александром?',
  history: [
    { role: 'user' as const, content: 'Привет' },
    { role: 'assistant' as const, content: 'Здравствуйте' },
  ],
  conversationSummary: 'Краткая сводка беседы.',
};

describe('ChatV2OrchestrationService.askEphemeral — безпамятный вход (Ф2a)', () => {
  it('возвращает поля ответа и НЕ создаёт ChatV2Conversation/Message и заголовок', async () => {
    const h = makeHarness(NORMAL_GOLDEN);

    const answer = await h.service.askEphemeral({ ...baseInput });

    expect(answer).toEqual(
      expect.objectContaining({
        text: NORMAL_GOLDEN.text,
        needsClarification: false,
        dataClass: 'internal',
        usedBlockIds: ['aaa111'],
        uncertaintyNote: null,
        mode: 'synthetic',
        answerKind: 'prose',
      }),
    );
    expect(h.conversationsCreate).not.toHaveBeenCalled();
    expect(h.appendMessage).not.toHaveBeenCalled();
    expect(h.generateTitle).not.toHaveBeenCalled();
  });

  it('answerKind=list + episodes проброшены из synthesis в ответ (Ф10 R12)', async () => {
    const LIST_GOLDEN: SynthesisResult = {
      text: 'Нашёл встречи: список.',
      citations: [],
      retrievalMeta: { usedBlockIds: ['aaa111'] },
      llmMeta: { model: 'deepseek', inputTokens: 1, outputTokens: 1 },
      uncertaintyNote: null,
      dataClass: 'internal',
      needsClarification: false,
      answerKind: 'list',
      episodes: [
        {
          id: 'ep-1',
          title: 'Планёрка',
          occurredAt: new Date('2026-06-20'),
          kind: 'meeting',
          rawEventId: 're-1',
        },
      ],
    };
    const h = makeHarness(LIST_GOLDEN);

    const answer = await h.service.askEphemeral({ ...baseInput });

    expect(answer.answerKind).toBe('list');
    expect(answer.episodes).toBeDefined();
    expect(answer.episodes!.length).toBe(1);
    expect(answer.episodes![0]!.rawEventId).toBe('re-1');
  });

  it('переданные history + summary проброшены в dialog.process как override', async () => {
    const h = makeHarness(NORMAL_GOLDEN);

    await h.service.askEphemeral({ ...baseInput });

    expect(h.dialogProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryOverride: 'Краткая сводка беседы.',
        historyOverride: [
          { role: 'user', content: 'Привет' },
          { role: 'assistant', content: 'Здравствуйте' },
        ],
      }),
    );
  });

  it('needsClarification:true → гейт заземления НЕ вызван, answerCache НЕ записан, флаг проброшен', async () => {
    const h = makeHarness(CLARIFY_GOLDEN);

    const answer = await h.service.askEphemeral({ ...baseInput });

    expect(answer).toEqual(
      expect.objectContaining({ needsClarification: true }),
    );
    expect(answer.text).toBe(CLARIFY_GOLDEN.text);
    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.answerCacheSet).not.toHaveBeenCalled();
    expect(h.conversationsCreate).not.toHaveBeenCalled();
    expect(h.appendMessage).not.toHaveBeenCalled();
  });

  it('needsClarification:false → гейт заземления вызван (1 llm.call), answerCache записан', async () => {
    const h = makeHarness(NORMAL_GOLDEN);

    await h.service.askEphemeral({ ...baseInput });

    expect(h.llmCall).toHaveBeenCalledTimes(1);
    expect(h.answerCacheSet).toHaveBeenCalledTimes(1);
  });
});
