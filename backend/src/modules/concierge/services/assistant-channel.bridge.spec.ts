import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { InboundMessage } from '../../conversational/types/channel.types';
import { validateEventPayload } from '../../conversational/types/event-payload.registry';
import type { RbacService } from '../../rbac/rbac.service';

import {
  AssistantChannelBridge,
  CHANNEL_TOOL_WHITELIST_MANAGER,
  CHANNEL_TOOL_WHITELIST_SELF,
} from './assistant-channel.bridge';
import type { ConciergeService, ConciergeStreamEvent } from './concierge.service';
import type { ToolRouterService } from './tool-router.service';

async function* eventStream(events: ConciergeStreamEvent[]): AsyncIterable<ConciergeStreamEvent> {
  for (const e of events) {
    yield e;
  }
}

function makeBridge(
  opts: {
    events: ConciergeStreamEvent[];
    redisGetReturns?: string | null;
    redisState?: Record<string, string | null>;
    membershipRole?: string | null;
    judgeText?: string;
  } = { events: [] },
) {
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

  const redisGet = vi.fn(async (key: string) => {
    if (opts.redisState && key in opts.redisState) {
      return opts.redisState[key] ?? null;
    }
    if (key.startsWith('concierge:confirm:')) return null;
    return opts.redisGetReturns ?? null;
  });
  const redisSet = vi.fn().mockResolvedValue('OK');
  const redisDel = vi.fn().mockResolvedValue(1);
  const redis = {
    client: { get: redisGet, set: redisSet, del: redisDel },
  } as unknown as RedisService;

  const getMembershipRole = vi.fn().mockResolvedValue(opts.membershipRole ?? null);
  const rbac = { getMembershipRole } as unknown as RbacService;

  const toolRouterExecute = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    result: { id: 'res-1' },
    tool: { name: 'cancel_meeting', method: 'POST' },
  });
  const toolRouter = {
    execute: toolRouterExecute,
  } as unknown as ToolRouterService;

  const llmCall = vi.fn().mockResolvedValue({
    text: opts.judgeText ?? '{"decision":"unclear","confidence":0.3}',
    modelUsed: 'mock',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durationMs: 0,
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const incAssistantTurn = vi.fn();
  const metrics = { incAssistantTurn } as unknown as BusinessMetricsService;

  const bridge = new AssistantChannelBridge(
    concierge,
    conversational,
    redis,
    rbac,
    toolRouter,
    llm,
    metrics,
  );
  bridge.onModuleInit();

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
    redisDel,
    getMembershipRole,
    toolRouterExecute,
    llmCall,
    incAssistantTurn,
  };
}

function expectChatAnswerPayloadValid(sendChatReply: ReturnType<typeof vi.fn>): void {
  const args = (sendChatReply.mock.calls[0]?.[0] ?? {}) as {
    conversationId?: string;
    messageId?: string;
    text?: string;
  };
  expect(() =>
    validateEventPayload('chat.answer', {
      conversationId: args.conversationId,
      messageId: args.messageId,
      text: args.text,
      citationsCount: 0,
    }),
  ).not.toThrow();
}

const turn = (
  overrides: Partial<Extract<InboundMessage, { type: 'assistant_turn' }>> = {},
): InboundMessage => ({
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
    expect(subscribeInbound).toHaveBeenCalledWith('assistant_turn', expect.any(Function));
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

    expect(processMock).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1' }));
  });

  it('без originChannelBindingId — Redis не трогается, разговор новый', async () => {
    const { handler, processMock, redisGet, redisSet, sendChatReply } = makeBridge({
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
    expect(sendChatReply).toHaveBeenCalledWith(expect.objectContaining({ text: 'Ок.' }));
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

    expect(sendChatReply).toHaveBeenCalledWith(expect.objectContaining({ text: 'Готово.' }));
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

describe('AssistantChannelBridge — Ф6 канальный whitelist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const okEvents: ConciergeStreamEvent[] = [
    { type: 'started', conversationId: 'conv-1' },
    { type: 'message', text: 'Ответ.' },
    { type: 'done', messageId: 'msg-1' },
  ];

  it('рядовой (membership роль НЕ manager+) → process получил SELF-список + confirmHold', async () => {
    const { handler, processMock, getMembershipRole } = makeBridge({
      events: okEvents,
      membershipRole: null,
    });

    await handler(turn());

    expect(getMembershipRole).toHaveBeenCalledWith('org-1', 'user-42');
    const args = (processMock.mock.calls[0]?.[0] ?? {}) as {
      toolWhitelist?: string[];
      confirmHold?: boolean;
    };
    expect(args.toolWhitelist).toEqual([...CHANNEL_TOOL_WHITELIST_SELF]);
    expect(args.toolWhitelist).not.toContain('get_person_pulse');
    expect(args.toolWhitelist).not.toContain('get_team_health');
    expect(args.toolWhitelist).not.toContain('search_knowledge');
    expect(args.toolWhitelist).toContain('ask_chat_v2');
    expect(args.toolWhitelist).toContain('create_task');
    expect(args.toolWhitelist).toContain('search_tasks');
    expect(args.toolWhitelist).toContain('ingest_note');
    expect(args.confirmHold).toBe(true);
  });

  it('owner → process получил расширенный MANAGER-список', async () => {
    const { handler, processMock } = makeBridge({
      events: okEvents,
      membershipRole: 'owner',
    });

    await handler(turn());

    const args = (processMock.mock.calls[0]?.[0] ?? {}) as {
      toolWhitelist?: string[];
    };
    expect(args.toolWhitelist).toEqual([...CHANNEL_TOOL_WHITELIST_MANAGER]);
    expect(args.toolWhitelist).toContain('get_person_pulse');
    expect(args.toolWhitelist).toContain('list_overdue_promises');
  });

  it('провал getMembershipRole → безопасный SELF-список (fail-open в узкий набор)', async () => {
    const { handler, processMock, getMembershipRole } = makeBridge({
      events: okEvents,
    });
    getMembershipRole.mockRejectedValueOnce(new Error('db down'));

    await handler(turn());

    const args = (processMock.mock.calls[0]?.[0] ?? {}) as {
      toolWhitelist?: string[];
    };
    expect(args.toolWhitelist).toEqual([...CHANNEL_TOOL_WHITELIST_SELF]);
  });
});

describe('AssistantChannelBridge — Ф6 текст-подтверждение (zero-button)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CONFIRM_KEY = 'concierge:confirm:binding-1';
  const pendingState = JSON.stringify({
    toolName: 'cancel_meeting',
    params: { id: 'm-1' },
    conversationId: 'conv-7',
    preview: 'отменить встречу (id: m-1)',
  });

  it('confirm_required → Redis set (TTL 300) + вопрос «Подтвердите действие…» в канал', async () => {
    const { handler, redisSet, sendChatReply } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-7' },
        {
          type: 'confirm_required',
          toolName: 'cancel_meeting',
          params: { id: 'm-1' },
          preview: 'отменить встречу (id: m-1)',
        },
        { type: 'done', messageId: 'msg-hold' },
      ],
    });

    await handler(turn());

    expect(redisSet).toHaveBeenCalledWith(
      CONFIRM_KEY,
      expect.stringContaining('"toolName":"cancel_meeting"'),
      'EX',
      300,
    );
    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as { text?: string };
    expect(sent.text).toContain('Подтвердите действие: отменить встречу');
    expect(sent.text).toContain('«да»');
    expect(sent.text).toContain('«нет»');
  });

  it('«да» при висящем confirm-ключе → del ДО execute, исполнение отложенного tool, «Готово…»; process НЕ вызван', async () => {
    const { handler, processMock, redisDel, toolRouterExecute, sendChatReply, llmCall } =
      makeBridge({
        events: [],
        redisState: { [CONFIRM_KEY]: pendingState },
      });

    await handler(turn({ text: 'да' }));

    expect(processMock).not.toHaveBeenCalled();
    expect(llmCall).not.toHaveBeenCalled();

    expect(toolRouterExecute).toHaveBeenCalledWith({
      toolName: 'cancel_meeting',
      args: { id: 'm-1' },
      userId: 'user-42',
      tenantId: 'org-1',
      authMode: 'service',
    });

    expect(redisDel).toHaveBeenCalledWith(CONFIRM_KEY);
    const delOrder = redisDel.mock.invocationCallOrder[0]!;
    const execOrder = toolRouterExecute.mock.invocationCallOrder[0]!;
    expect(delOrder).toBeLessThan(execOrder);

    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as {
      text?: string;
      conversationId?: string;
    };
    expect(sent.text).toContain('Готово');
    expect(sent.conversationId).toBe('conv-7');
  });

  it('«нет» → отмена: ключ удалён, execute НЕ вызван, «Отменил.»', async () => {
    const { handler, redisDel, toolRouterExecute, sendChatReply } = makeBridge({
      events: [],
      redisState: { [CONFIRM_KEY]: pendingState },
    });

    await handler(turn({ text: 'нет' }));

    expect(toolRouterExecute).not.toHaveBeenCalled();
    expect(redisDel).toHaveBeenCalledWith(CONFIRM_KEY);
    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as { text?: string };
    expect(sent.text).toBe('Отменил.');
  });

  it('«может быть» → LLM-judge unclear: переспрос, ключ ЖИВ, execute НЕ вызван', async () => {
    const { handler, redisDel, toolRouterExecute, sendChatReply, llmCall } = makeBridge({
      events: [],
      redisState: { [CONFIRM_KEY]: pendingState },
      judgeText: '{"decision":"unclear","confidence":0.4}',
    });

    await handler(turn({ text: 'может быть' }));

    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'assistant-confirm-classify' }),
    );
    expect(toolRouterExecute).not.toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as { text?: string };
    expect(sent.text).toBe('Не понял. Ответьте «да» или «нет».');
  });

  it('LLM-judge confirm (confidence ≥ 0.6) → исполнение', async () => {
    const { handler, toolRouterExecute, sendChatReply } = makeBridge({
      events: [],
      redisState: { [CONFIRM_KEY]: pendingState },
      judgeText: '{"decision":"confirm","confidence":0.9}',
    });

    await handler(turn({ text: 'ну валяй, делай' }));

    expect(toolRouterExecute).toHaveBeenCalledTimes(1);
    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as { text?: string };
    expect(sent.text).toContain('Готово');
  });

  it('повторный «да» после исполнения (ключа нет) → обычный ход в process', async () => {
    const { handler, processMock, toolRouterExecute } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-8' },
        { type: 'message', text: 'Чем ещё помочь?' },
        { type: 'done', messageId: 'msg-2' },
      ],
      redisState: { [CONFIRM_KEY]: null },
    });

    await handler(turn({ text: 'да' }));

    expect(toolRouterExecute).not.toHaveBeenCalled();
    expect(processMock).toHaveBeenCalledTimes(1);
    const args = (processMock.mock.calls[0]?.[0] ?? {}) as {
      userMessage?: string;
    };
    expect(args.userMessage).toBe('да');
  });

  it('execute вернул ok=false → «Не получилось: …» с ошибкой', async () => {
    const { handler, toolRouterExecute, sendChatReply } = makeBridge({
      events: [],
      redisState: { [CONFIRM_KEY]: pendingState },
    });
    toolRouterExecute.mockResolvedValueOnce({
      ok: false,
      status: 403,
      result: null,
      errorMessage: 'RBAC: у вас нет прав на meeting/delete',
      tool: { name: 'cancel_meeting', method: 'POST' },
    });

    await handler(turn({ text: 'да' }));

    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as { text?: string };
    expect(sent.text).toContain('Не получилось');
    expect(sent.text).toContain('RBAC');
  });

  it('H-2: del вернул 0 (конкурентный «да» успел раньше) → execute НЕ вызван, ответ не дублируется', async () => {
    const { handler, redisDel, toolRouterExecute, sendChatReply } = makeBridge({
      events: [],
      redisState: { [CONFIRM_KEY]: pendingState },
    });
    redisDel.mockResolvedValueOnce(0);

    await handler(turn({ text: 'да' }));

    expect(redisDel).toHaveBeenCalledWith(CONFIRM_KEY);
    expect(toolRouterExecute).not.toHaveBeenCalled();
    expect(sendChatReply).not.toHaveBeenCalled();
  });
});

describe('AssistantChannelBridge — Ф2c clarify-ключ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CLARIFY_KEY = 'concierge:clarify:binding-1';

  it('ход с message needsClarification:true → Redis set clarify-ключа (EX 600)', async () => {
    const { handler, redisSet } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-c' },
        { type: 'message', text: 'Какую именно встречу — июньскую или майскую?', needsClarification: true },
        { type: 'done', messageId: 'msg-c' },
      ],
    });

    await handler(turn());

    expect(redisSet).toHaveBeenCalledWith(CLARIFY_KEY, '1', 'EX', 600);
  });

  it('обычный ответ (needsClarification отсутствует) → Redis del clarify-ключа', async () => {
    const { handler, redisSet, redisDel } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-n' },
        { type: 'message', text: 'Вот ваши задачи: A, B.' },
        { type: 'done', messageId: 'msg-n' },
      ],
    });

    await handler(turn());

    expect(redisDel).toHaveBeenCalledWith(CLARIFY_KEY);
    expect(redisSet).not.toHaveBeenCalledWith(CLARIFY_KEY, '1', 'EX', 600);
  });

  it('confirm_required → clarify-ключ НЕ ставится (set/del clarify не вызываются)', async () => {
    const { handler, redisSet, redisDel } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-h' },
        {
          type: 'confirm_required',
          toolName: 'cancel_meeting',
          params: { id: 'm-1' },
          preview: 'отменить встречу (id: m-1)',
        },
        { type: 'done', messageId: 'msg-hold' },
      ],
    });

    await handler(turn());

    expect(redisSet).not.toHaveBeenCalledWith(CLARIFY_KEY, '1', 'EX', 600);
    expect(redisDel).not.toHaveBeenCalledWith(CLARIFY_KEY);
  });
});

describe('AssistantChannelBridge — C-1 совместимость payload с registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CONFIRM_KEY = 'concierge:confirm:binding-1';
  const pendingState = JSON.stringify({
    toolName: 'cancel_meeting',
    params: { id: 'm-1' },
    conversationId: '',
    preview: 'отменить встречу (id: m-1)',
  });

  it('confirm-вопрос (sendConfirmFlowReply, нет ConciergeMessage) → payload валиден, id синтетические непустые', async () => {
    const { handler, sendChatReply } = makeBridge({
      events: [],
      redisState: { [CONFIRM_KEY]: pendingState },
    });

    await handler(turn({ text: 'да' }));

    expect(sendChatReply).toHaveBeenCalledTimes(1);
    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as {
      conversationId?: string;
      messageId?: string;
    };
    expect(sent.messageId).toBe('assistant-channel');
    expect(sent.conversationId).toBe('binding-1');
    expectChatAnswerPayloadValid(sendChatReply);
  });

  it('quota-путь (quota_exceeded ДО started → conversationId пуст) → payload валиден', async () => {
    const { handler, sendChatReply } = makeBridge({
      events: [{ type: 'quota_exceeded', scope: 'user_daily' }],
    });

    await handler(turn());

    const sent = (sendChatReply.mock.calls[0]?.[0] ?? {}) as {
      conversationId?: string;
      messageId?: string;
    };
    expect(sent.conversationId).toBe('binding-1');
    expect(sent.messageId).toBe('assistant-channel');
    expectChatAnswerPayloadValid(sendChatReply);
  });
});

describe('AssistantChannelBridge — L-4 метрика исходов ходов', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('успешный ход → outcome=ok', async () => {
    const { handler, incAssistantTurn } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-1' },
        { type: 'message', text: 'Ответ.' },
        { type: 'done', messageId: 'msg-1' },
      ],
    });
    await handler(turn());
    expect(incAssistantTurn).toHaveBeenCalledWith({ outcome: 'ok' });
  });

  it('quota_exceeded → outcome=quota', async () => {
    const { handler, incAssistantTurn } = makeBridge({
      events: [{ type: 'quota_exceeded', scope: 'user_daily' }],
    });
    await handler(turn());
    expect(incAssistantTurn).toHaveBeenCalledWith({ outcome: 'quota' });
  });

  it('error → outcome=error', async () => {
    const { handler, incAssistantTurn } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-e' },
        { type: 'error', code: 'llm_error', message: 'LLM недоступен' },
      ],
    });
    await handler(turn());
    expect(incAssistantTurn).toHaveBeenCalledWith({ outcome: 'error' });
  });

  it('confirm_required → outcome=confirm_hold', async () => {
    const { handler, incAssistantTurn } = makeBridge({
      events: [
        { type: 'started', conversationId: 'conv-7' },
        {
          type: 'confirm_required',
          toolName: 'cancel_meeting',
          params: { id: 'm-1' },
          preview: 'отменить встречу (id: m-1)',
        },
        { type: 'done', messageId: 'msg-hold' },
      ],
    });
    await handler(turn());
    expect(incAssistantTurn).toHaveBeenCalledWith({ outcome: 'confirm_hold' });
  });

  it('process бросил → outcome=handler_error (внешний catch)', async () => {
    const { handler, processMock, incAssistantTurn } = makeBridge({
      events: [],
    });
    processMock.mockImplementation(() => {
      // eslint-disable-next-line require-yield
      return (async function* (): AsyncIterable<ConciergeStreamEvent> {
        throw new Error('boom');
      })();
    });
    await handler(turn());
    expect(incAssistantTurn).toHaveBeenCalledWith({ outcome: 'handler_error' });
  });
});
