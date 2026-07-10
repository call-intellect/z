import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../../common/config/index';
import type { BusinessMetricsService } from '../../../../../common/metrics/business-metrics.service';
import type { ProtocolAdapterProviderInfo } from '../protocol-adapter.types';

interface FakeChatCompletions {
  create: ReturnType<typeof vi.fn>;
}

let nextCreateImpl: ((p: unknown) => Promise<unknown>) | null = null;
let lastCallArgs: Record<string, unknown> | null = null;

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat: { completions: FakeChatCompletions };
      constructor(_opts: unknown) {
        const create = vi.fn(async (p: unknown) => {
          lastCallArgs = p as Record<string, unknown>;
          if (!nextCreateImpl) {
            throw new Error('nextCreateImpl не задан перед complete()');
          }
          return nextCreateImpl(p);
        });
        this.chat = { completions: { create } };
      }
    },
  };
});

import { JSON_MODE_USER_SUFFIX } from '../../json-mode.util';

import { OpenAiChatProtocolAdapter } from './openai-chat.adapter';

function makeCfg(): TypedConfigService {
  return {} as unknown as TypedConfigService;
}

function makeMetricsMock(): {
  metrics: BusinessMetricsService;
  guard: ReturnType<typeof vi.fn>;
} {
  const guard = vi.fn();
  const metrics = {
    incLlmThinkingModelGuard: guard,
  } as unknown as BusinessMetricsService;
  return { metrics, guard };
}

function makeProvider(): ProtocolAdapterProviderInfo {
  return {
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    defaultModel: 'deepseek-v4-flash',
  } as unknown as ProtocolAdapterProviderInfo;
}

function okResponse(opts?: {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
}): unknown {
  return {
    choices: [
      {
        message: {
          content: opts?.content ?? '',
          tool_calls: opts?.toolCalls?.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

const FACTS_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['facts'],
  properties: { facts: { type: 'array', items: { type: 'string' } } },
};

describe('OpenAiChatProtocolAdapter — thinking-models guard', () => {
  beforeEach(() => {
    nextCreateImpl = null;
    lastCallArgs = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('flash (thinking) + json_schema → автоконверт в tool + guard.schema-to-tool', async () => {
    const { metrics, guard } = makeMetricsMock();
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), metrics);
    nextCreateImpl = async () =>
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      });

    const out = await adapter.complete({
      provider: makeProvider(),
      input: {
        system: { text: 'sys' },
        user: 'u',
        model: 'deepseek-v4-flash',
        responseFormat: {
          type: 'json_schema',
          name: 'facts',
          schema: FACTS_SCHEMA,
          strict: true,
        },
      },
    });

    expect(out.text).toBe('{"facts":["a"]}');
    expect(guard).toHaveBeenCalledWith({
      kind: 'schema-to-tool',
      model: 'deepseek-v4-flash',
    });
    expect(lastCallArgs?.['response_format']).toBeUndefined();
    expect(lastCallArgs?.['tool_choice']).toBe('auto');
    expect(lastCallArgs?.['tools']).toBeDefined();
  });

  it('pro + json_schema (без tools) → автоконверт в tool + tool_choice=auto + hint + guard.schema-to-tool', async () => {
    const { metrics, guard } = makeMetricsMock();
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), metrics);
    nextCreateImpl = async () =>
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["x","y"]}' }],
      });

    const out = await adapter.complete({
      provider: makeProvider(),
      input: {
        system: { text: 'sys' },
        user: 'извлеки факты',
        model: 'deepseek-v4-pro',
        responseFormat: {
          type: 'json_schema',
          name: 'facts',
          schema: FACTS_SCHEMA,
          strict: true,
        },
      },
    });

    expect(out.text).toBe('{"facts":["x","y"]}');
    expect(out.toolCalls).toEqual([{ name: 'submit_facts', input: { facts: ['x', 'y'] } }]);
    expect(guard).toHaveBeenCalledWith({
      kind: 'schema-to-tool',
      model: 'deepseek-v4-pro',
    });
    expect(lastCallArgs?.['response_format']).toBeUndefined();
    expect(lastCallArgs?.['tool_choice']).toBe('auto');
    expect(lastCallArgs?.['tools']).toEqual([
      {
        type: 'function',
        function: {
          name: 'submit_facts',
          description: expect.stringContaining('facts'),
          parameters: FACTS_SCHEMA,
        },
      },
    ]);
    const messages = lastCallArgs?.['messages'] as Array<{
      role: string;
      content: string;
    }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('извлеки факты');
    expect(userMsg?.content).toContain('submit_facts');
  });

  it('pro + caller tools + json_schema → strict json_schema снят, guard.strict-stripped', async () => {
    const { metrics, guard } = makeMetricsMock();
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), metrics);
    nextCreateImpl = async () => okResponse({ content: 'ответ' });

    await adapter.complete({
      provider: makeProvider(),
      input: {
        system: { text: 'sys' },
        user: 'u',
        model: 'deepseek-v4-pro',
        tools: [
          {
            name: 'my_tool',
            description: 'desc',
            input_schema: { type: 'object', properties: {} },
          },
        ],
        responseFormat: {
          type: 'json_schema',
          name: 'irrelevant',
          schema: FACTS_SCHEMA,
          strict: true,
        },
      },
    });

    expect(guard).toHaveBeenCalledWith({
      kind: 'strict-stripped',
      model: 'deepseek-v4-pro',
    });
    expect(lastCallArgs?.['response_format']).toBeUndefined();
    expect(lastCallArgs?.['tool_choice']).toBe('auto');
    expect(lastCallArgs?.['tools']).toBeDefined();
  });

  it('pro + json_object → response_format: json_object без конвертации', async () => {
    const { metrics, guard } = makeMetricsMock();
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), metrics);
    nextCreateImpl = async () => okResponse({ content: '{"ok":true}' });

    await adapter.complete({
      provider: makeProvider(),
      input: {
        system: { text: 's' },
        user: 'u',
        model: 'deepseek-v4-pro',
        responseFormat: { type: 'json_object' },
      },
    });

    expect(guard).not.toHaveBeenCalled();
    expect(lastCallArgs?.['response_format']).toEqual({ type: 'json_object' });
    expect(lastCallArgs?.['tools']).toBeUndefined();
    expect(lastCallArgs?.['tool_choice']).toBeUndefined();
  });

  it('json_object + system/user без слова json → guard дописывает суффикс в последний user отправляемого body', async () => {
    const { metrics } = makeMetricsMock();
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), metrics);
    nextCreateImpl = async () => okResponse({ content: '{"ok":true}' });

    await adapter.complete({
      provider: makeProvider(),
      input: {
        system: { text: 'извлеки факты из текста' },
        user: 'вот данные встречи',
        model: 'deepseek-v4-flash',
        responseFormat: { type: 'json_object' },
      },
    });

    expect(lastCallArgs?.['response_format']).toEqual({ type: 'json_object' });
    const messages = lastCallArgs?.['messages'] as Array<{
      role: string;
      content: string;
    }>;
    const userMsg = [...messages].reverse().find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('вот данные встречи');
    expect(userMsg?.content).toContain(JSON_MODE_USER_SUFFIX.trim());
    expect(/json/i.test(userMsg?.content ?? '')).toBe(true);
  });

  it('json_object + слово json уже в системном промпте → guard не дописывает суффикс', async () => {
    const { metrics } = makeMetricsMock();
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), metrics);
    nextCreateImpl = async () => okResponse({ content: '{"ok":true}' });

    await adapter.complete({
      provider: makeProvider(),
      input: {
        system: { text: 'верни ответ в формате JSON' },
        user: 'вот данные встречи',
        model: 'deepseek-v4-flash',
        responseFormat: { type: 'json_object' },
      },
    });

    const messages = lastCallArgs?.['messages'] as Array<{
      role: string;
      content: string;
    }>;
    const userMsg = [...messages].reverse().find((m) => m.role === 'user');
    expect(userMsg?.content).toBe('вот данные встречи');
    expect(userMsg?.content).not.toContain(JSON_MODE_USER_SUFFIX.trim());
  });
});

describe('OpenAiChatProtocolAdapter — max_completion_tokens retry (новые модели OpenAI)', () => {
  beforeEach(() => {
    nextCreateImpl = null;
    lastCallArgs = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function maxTokensUnsupportedError(): Error & { status?: number } {
    const e = new Error(
      "400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    ) as Error & { status?: number };
    e.status = 400;
    return e;
  }

  it('400 «use max_completion_tokens» → повтор с заменой параметра, ответ отдан', async () => {
    let calls = 0;
    nextCreateImpl = async () => {
      calls += 1;
      if (calls === 1) throw maxTokensUnsupportedError();
      return okResponse({ content: 'proxy works' });
    };
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), makeMetricsMock().metrics);

    const out = await adapter.complete({
      provider: {
        ...makeProvider(),
        name: 'openai-via-proxy',
      } as unknown as ProtocolAdapterProviderInfo,
      input: {
        system: { text: 's' },
        user: 'u',
        model: 'gpt-5-mini',
        maxTokens: 128,
      },
    });

    expect(calls).toBe(2);
    expect(out.text).toBe('proxy works');
    expect(lastCallArgs?.['max_completion_tokens']).toBe(128);
    expect(lastCallArgs?.['max_tokens']).toBeUndefined();
  });

  it('обычная 400 → без повтора, LlmError наружу', async () => {
    let calls = 0;
    nextCreateImpl = async () => {
      calls += 1;
      const e = new Error('400 invalid request') as Error & { status?: number };
      e.status = 400;
      throw e;
    };
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), makeMetricsMock().metrics);

    await expect(
      adapter.complete({
        provider: makeProvider(),
        input: { system: { text: 's' }, user: 'u', model: 'gpt-4o-mini', maxTokens: 64 },
      }),
    ).rejects.toThrow('openai-chat deepseek: 400 invalid request');
    expect(calls).toBe(1);
  });

  it('без maxTokens во входе → повтора нет даже при этой ошибке', async () => {
    let calls = 0;
    nextCreateImpl = async () => {
      calls += 1;
      throw maxTokensUnsupportedError();
    };
    const adapter = new OpenAiChatProtocolAdapter(makeCfg(), makeMetricsMock().metrics);

    await expect(
      adapter.complete({
        provider: makeProvider(),
        input: { system: { text: 's' }, user: 'u', model: 'gpt-5-mini' },
      }),
    ).rejects.toThrow('max_completion_tokens');
    expect(calls).toBe(1);
  });
});
