import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { InboundMessage } from '../../conversational/types/channel.types';

import { AssistantChannelBridge } from './assistant-channel.bridge';
import type {
  ConciergeService,
  ConciergeStreamEvent,
} from './concierge.service';

/**
 * Unit-тесты Ф5 assistant-channels (2026-06-11) — AssistantChannelBridge.
 *
 * Покрывают контракт моста «каналы → помощник»:
 *   - текст → ConciergeService.process(authMode='service') → sendChatReply
 *     с финальным текстом (solicited:true, dataClass='internal');
 *   - память per-binding: первый ход пишет Redis-маппинг
 *     `concierge:channel-conv:<bindingId>` → conversationId (TTL 24ч),
 *     второй ход читает его и передаёт conversationId в process;
 *   - деградации: quota_exceeded / error / пустой ответ LLM (с tool_result
 *     и без) → русские тексты-заглушки.
 *
 * Все зависимости мокаются через `vi.fn()` + cast to type — паттерн проекта.
 */

/** Превращает массив событий в AsyncIterable (мок ConciergeService.process). */
async function* eventStream(
  events: ConciergeStreamEvent[],
): AsyncIterable<ConciergeStreamEvent> {
  for (const e of events) {
    yield e;
  }
}

function makeBridge(opts: {
  events: ConciergeStreamEvent[];
  redisGetReturns?: string | null;
} = { events: [] }) {
  const processMock = vi.fn().mockReturnValue(eventStream(opts.events));
  const concierge = {
    process: processMock,
  } as unknown as ConciergeService;

  const subscribeInbound = vi.fn();
  const sendChatReply = vi.fn().mockResolvedValue({ id: 'notif-1' });
  const conversational = {
    subscribeInbound,
    sendChatReply,
  } as unknown as ConversationalService;

  const redisGet = vi.fn().mockResolvedValue(opts.redisGetReturns ?? null);
  const redisSet = vi.fn().mockResolvedValue('OK');
  const redis = {
    client: { get: redisGet, set: redisSet },
  } as unknown as RedisService;

  const bridge = new AssistantChannelBridge(concierge, conversational, redis);
  bridge.onModuleInit();

  // Достаём зарегистрированный handler — мост подписан на 'assistant_turn'.
  const call = subscribeInbound.mock.calls[0]!;
  const handler = call[1] as (msg: InboundMessage) => Promise<void>;

  return {
    bridge,
    handler,
    processMock,
    subscribeInbound,
    sendChatReply,
    redisGet,
    redisSet,
  };
}

const turn = (overrides: Partial<Extract<InboundMessage, { type: 'assistant_turn' }>> = {}): InboundMessage => ({
  type: 'assistant_turn',
  userId: 'user-42',
  tenantId: 'org-1',
  text: 'покажи мои задачи на этой неделе',
  originChannelBindingId: 'binding-1',
  ...overrides,
});

describe('AssistantChannelBridge — Ф5 assistant_turn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('подписывается на inbound assistant_turn в onModuleInit', () => {
    const { subscribeInbound } = makeBridge({ events: [] });
    expect(subscribeInbound).toHaveBeenCalledWith(
      'assistant_turn',
      expect.any(Function),
    );
  });

  it('(а) текст → process(authMode=service) → sendChatReply с финальным текстом, solicited:true, dataClass=internal', async () => {
    const { handler, processMock, sendChatReply } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-new' },
        { type: 'thinking', text: 'Готовлю ответ…' },
        { type: 'message', text: 'Вот ваши задачи: A, B.' },
        { type: 'done', messageId: 'msg-9' },
      ],
    });

    await handler(turn());

    expect(processMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'покажи мои задачи на этой неделе',
        userId: 'user-42',
        tenantId: 'org-1',
        authMode: 'service',
      }),
    );
    // Память пуста (redis.get → null) → conversationId НЕ передаётся.
    expect(processMock.mock.calls[0]![0]).not.toHaveProperty('conversationId');

    expect(sendChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        userId: 'user-42',
        conversationId: 'conv-new',
        messageId: 'msg-9',
        text: 'Вот ваши задачи: A, B.',
        citationsCount: 0,
        originChannelBindingId: 'binding-1',
        dataClass: 'internal',
        solicited: true,
      }),
    );
  });

  it('(б) память: первый ход пишет Redis-маппинг binding → conversationId из started (TTL 24ч)', async () => {
    const { handler, redisGet, redisSet } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-new' },
        { type: 'message', text: 'Ответ.' },
        { type: 'done', messageId: 'msg-1' },
      ],
    });

    await handler(turn());

    expect(redisGet).toHaveBeenCalledWith('concierge:channel-conv:binding-1');
    expect(redisSet).toHaveBeenCalledWith(
      'concierge:channel-conv:binding-1',
      'conv-new',
      'EX',
      86_400,
    );
  });

  it('(б) память: второй ход (Redis.get → conv-1) передаёт conversationId в process', async () => {
    const { handler, processMock } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-1' },
        { type: 'message', text: 'Продолжаю.' },
        { type: 'done', messageId: 'msg-2' },
      ],
      redisGetReturns: 'conv-1',
    });

    await handler(turn());

    expect(processMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
    );
  });

  it('без originChannelBindingId — Redis не трогается, разговор новый', async () => {
    const { handler, processMock, redisGet, redisSet, sendChatReply } =
      makeBridge({
        events: [
          { type: 'started', conversationId: 'conv-x' },
          { type: 'message', text: 'Ок.' },
          { type: 'done', messageId: 'msg-3' },
        ],
      });

    const msg = turn();
    delete (msg as { originChannelBindingId?: string }).originChannelBindingId;
    await handler(msg);

    expect(redisGet).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
    expect(processMock.mock.calls[0]![0]).not.toHaveProperty('conversationId');
    expect(sendChatReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Ок.' }),
    );
  });

  it('(в) quota_exceeded → текст про дневной лимит, маппинг не пишется', async () => {
    const { handler, sendChatReply, redisSet } = makeBridge({
      events: [{ type: 'quota_exceeded', scope: 'user_daily' }],
    });

    await handler(turn());

    expect(sendChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Дневной лимит обращений к помощнику исчерпан — продолжим завтра.',
        solicited: true,
        dataClass: 'internal',
      }),
    );
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('(г) error → текст про временную недоступность', async () => {
    const { handler, sendChatReply } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-err' },
        { type: 'error', code: 'llm_error', message: 'LLM временно недоступен' },
      ],
    });

    await handler(turn());

    expect(sendChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Помощник временно недоступен, попробуйте позже.',
      }),
    );
  });

  it('(д) пустой message без tool_result → «Не получилось обработать запрос…»', async () => {
    const { handler, sendChatReply } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-e' },
        { type: 'message', text: '   ' },
        { type: 'done', messageId: 'msg-4' },
      ],
    });

    await handler(turn());

    expect(sendChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Не получилось обработать запрос, попробуйте переформулировать.',
      }),
    );
  });

  it('(д) пустой message c успешным tool_result → «Готово.»', async () => {
    const { handler, sendChatReply } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-t' },
        {
          type: 'tool_call',
          toolName: 'create_issue',
          params: {},
          requiresConfirm: false,
        },
        {
          type: 'tool_result',
          toolName: 'create_issue',
          ok: true,
          status: 201,
          preview: '{"id":"i-1"}',
        },
        { type: 'message', text: '' },
        { type: 'done', messageId: 'msg-5' },
      ],
    });

    await handler(turn());

    expect(sendChatReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Готово.' }),
    );
  });

  it('process бросил исключение → handler не пробрасывает (логирует), sendChatReply не вызван', async () => {
    const { handler, processMock, sendChatReply } = makeBridge({ events: [] });
    processMock.mockImplementation(() => {
      // eslint-disable-next-line require-yield
      return (async function* (): AsyncIterable<ConciergeStreamEvent> {
        throw new Error('boom');
      })();
    });

    await expect(handler(turn())).resolves.toBeUndefined();
    expect(sendChatReply).not.toHaveBeenCalled();
  });

  it('сообщение чужого типа игнорируется', async () => {
    const { handler, processMock } = makeBridge({ events: [] });

    await handler({
      type: 'free_note',
      userId: 'user-42',
      tenantId: 'org-1',
      text: 'заметка',
    });

    expect(processMock).not.toHaveBeenCalled();
  });
});
