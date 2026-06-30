import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationalService } from '../conversational/conversational.service';
import type { InboundMessage } from '../conversational/types/channel.types';

import { ChatV2OmnichannelBridge } from './chat-v2.module';
import type { ChatAnswer, ChatV2OrchestrationService } from './chat-v2.service';

function makeAnswer(over?: Partial<ChatAnswer>): ChatAnswer {
  return {
    conversationId: 'conv-1',
    messageId: 'msg-1',
    text: 'Зарплата Иванова — 250 000 ₽.',
    citations: [],
    uncertaintyNote: null,
    mode: 'synthetic',
    cacheHit: false,
    dataClass: 'internal',
    needsClarification: false,
    answerKind: 'prose',
    ...over,
  };
}

function makeBridge(answer: ChatAnswer): {
  handler: (msg: InboundMessage) => Promise<void>;
  ask: ReturnType<typeof vi.fn>;
  sendChatReply: ReturnType<typeof vi.fn>;
} {
  const ask = vi.fn().mockResolvedValue(answer);
  const orchestration = { ask } as unknown as ChatV2OrchestrationService;

  const subscribeInbound = vi.fn();
  const sendChatReply = vi.fn().mockResolvedValue({ id: 'notif-1' });
  const conversational = {
    subscribeInbound,
    sendChatReply,
  } as unknown as ConversationalService;

  const bridge = new ChatV2OmnichannelBridge(orchestration, conversational);
  bridge.onModuleInit();

  const call = subscribeInbound.mock.calls[0]!;
  const handler = call[1] as (msg: InboundMessage) => Promise<void>;
  return { handler, ask, sendChatReply };
}

const query = (): InboundMessage => ({
  type: 'chat_query',
  userId: 'user-1',
  tenantId: 'org-1',
  question: 'какая зарплата у Иванова?',
  originChannelBindingId: 'binding-1',
});

describe('ChatV2OmnichannelBridge — M-1 derived dataClass ответа', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dataClass=sensitive → в канал уходит указатель на кабинет, НЕ исходный текст', async () => {
    const { handler, sendChatReply } = makeBridge(makeAnswer({ dataClass: 'sensitive' }));

    await handler(query());

    expect(sendChatReply).toHaveBeenCalledTimes(1);
    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as {
      text?: string;
      dataClass?: string;
      solicited?: boolean;
    };
    expect(sent.text).toContain('кабинете');
    expect(sent.text).toContain('/chat?conversation=conv-1');
    expect(sent.text).not.toContain('250 000');
    expect(sent.dataClass).toBe('internal');
    expect(sent.solicited).toBe(true);
  });

  it('dataClass=private → тоже указатель (не текст)', async () => {
    const { handler, sendChatReply } = makeBridge(makeAnswer({ dataClass: 'private' }));

    await handler(query());

    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as { text?: string };
    expect(sent.text).toContain('кабинете');
    expect(sent.text).not.toContain('250 000');
  });

  it('dataClass=internal → исходный текст как раньше', async () => {
    const { handler, sendChatReply } = makeBridge(makeAnswer({ dataClass: 'internal' }));

    await handler(query());

    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as {
      text?: string;
      dataClass?: string;
    };
    expect(sent.text).toBe('Зарплата Иванова — 250 000 ₽.');
    expect(sent.dataClass).toBe('internal');
  });
});
