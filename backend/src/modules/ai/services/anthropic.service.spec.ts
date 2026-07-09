import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

let lastSdkInstance: {
  messages: { create: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> };
} | null = null;
let lastSdkCtorOpts: unknown = null;

const DEFAULT_STREAM_RESULT = {
  finalMessage: async () => ({
    content: [{ type: 'text', text: '' }],
    usage: { input_tokens: 0, output_tokens: 0 },
  }),
};

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages: { create: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> };
      constructor(opts: unknown) {
        lastSdkCtorOpts = opts;
        this.messages = {
          create: vi.fn(),
          // Дефолтная реализация — иначе синхронный вызов до mockReturnValueOnce
          // (override строит клиент до первого await внутри complete()) падает
          // на `undefined.finalMessage is not a function`. mockReturnValueOnce,
          // выставленный ДО complete(), по-прежнему приоритетнее.
          stream: vi.fn(async () => DEFAULT_STREAM_RESULT),
        };
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- тест-фейк: захватываем созданный SDK-инстанс в module-scope для assertions
        lastSdkInstance = this;
      }
    },
  };
});

import { AnthropicService } from './anthropic.service';
import { LlmError } from './llm.types';

function makeCfg(): TypedConfigService {
  return {
    ai: {
      anthropic: {
        apiKey: 'sk-ant-test',
        model: 'claude-sonnet-4-6',
        useProxy: false,
        proxyUrl: 'https://proxy.test',
      },
    },
  } as unknown as TypedConfigService;
}

describe('AnthropicService.complete', () => {
  beforeEach(() => {
    lastSdkInstance = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('streaming успешен → возвращает text + tokens', async () => {
    new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => ({
        content: [{ type: 'text', text: 'Привет' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      }),
    });

    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk2 not set');
    const sdk2 = lastSdkInstance;
    sdk2.messages.stream.mockReturnValueOnce({
      finalMessage: async () => ({
        content: [{ type: 'text', text: 'Привет' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      }),
    });

    const result = await svc.complete({
      system: { text: 'Ты помощник' },
      user: 'Скажи привет',
    });

    expect(result.text).toBe('Привет');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(30);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  it('streaming падает → fallback на non-streaming', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => {
        throw new Error('stream broken');
      },
    });
    sdk.messages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'fallback ok' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await svc.complete({
      system: { text: 'sys' },
      user: 'u',
    });
    expect(result.text).toBe('fallback ok');
    expect(sdk.messages.create).toHaveBeenCalledOnce();
  });

  it('streaming 403 → сразу LlmError(403)', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => {
        const err = new Error('blocked');
        (err as unknown as { status: number }).status = 403;
        throw err;
      },
    });

    await expect(svc.complete({ system: { text: 's' }, user: 'u' })).rejects.toBeInstanceOf(
      LlmError,
    );
    expect(sdk.messages.create).not.toHaveBeenCalled();
  });

  it('tool_use возвращается в toolCalls', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => ({
        content: [{ type: 'tool_use', name: 'extract_x', input: { foo: 'bar' } }],
        usage: { input_tokens: 50, output_tokens: 20 },
      }),
    });

    const result = await svc.complete({
      system: { text: 's' },
      user: 'u',
      tools: [
        {
          name: 'extract_x',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    });

    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([{ name: 'extract_x', input: { foo: 'bar' } }]);
  });
});

describe('AnthropicService.complete: T7-F6 responseFormat:json_schema → tool_use', () => {
  beforeEach(() => {
    lastSdkInstance = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('object-схема: request содержит synthetic tool + tool_choice', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'json_response',
            input: { intent: 'factual' },
          },
        ],
        usage: { input_tokens: 30, output_tokens: 10 },
      }),
    });

    const schema = {
      type: 'object',
      properties: { intent: { type: 'string' } },
      required: ['intent'],
      additionalProperties: false,
    };

    const result = await svc.complete({
      system: { text: 's' },
      user: 'u',
      responseFormat: {
        type: 'json_schema',
        name: 'classify_response',
        strict: true,
        schema,
      },
    });

    expect(result.text).toBe(JSON.stringify({ intent: 'factual' }));

    const calls = sdk.messages.stream.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const req = calls[0]?.[0] as {
      tools?: Array<{ name: string }>;
      tool_choice?: { type: string; name?: string };
    };
    expect(req.tools).toBeDefined();
    expect(req.tools?.[0]?.name).toBe('json_response');
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'json_response' });
  });

  it('non-object root: модель возвращает { result: [...] }, mapper извлекает .result', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'json_response',
            input: { result: [1, 2, 3] },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const result = await svc.complete({
      system: { text: 's' },
      user: 'u',
      responseFormat: {
        type: 'json_schema',
        name: 'arr_response',
        strict: true,
        schema: { type: 'array', items: { type: 'number' } },
      },
    });

    expect(result.text).toBe(JSON.stringify([1, 2, 3]));
  });

  it('без responseFormat: tools/tool_choice НЕ передаются', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    });

    await svc.complete({
      system: { text: 's' },
      user: 'u',
    });

    const req = sdk.messages.stream.mock.calls[0]?.[0] as {
      tools?: unknown;
      tool_choice?: unknown;
    };
    expect(req.tools).toBeUndefined();
    expect(req.tool_choice).toBeUndefined();
  });
});

describe('AnthropicService.complete: connection-override (Ф3)', () => {
  beforeEach(() => {
    lastSdkInstance = null;
    lastSdkCtorOpts = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('override передан → новый клиент строится с override.baseUrl/apiKey (не с ENV/конструкторским клиентом)', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('constructor sdk not set');
    const constructorSdk = lastSdkInstance;
    const constructorOpts = lastSdkCtorOpts;

    const result = await svc.complete(
      { system: { text: 's' }, user: 'u' },
      { baseUrl: 'https://override.example/v1', apiKey: 'override-key' },
    );

    expect(lastSdkInstance).not.toBe(constructorSdk);
    const capturedOpts = lastSdkCtorOpts as { apiKey?: string; baseURL?: string };
    expect(capturedOpts).not.toBe(constructorOpts);
    expect(capturedOpts.baseURL).toBe('https://override.example/v1');
    expect(capturedOpts.apiKey).toBe('override-key');
    expect(result.text).toBe('');
  });

  it('override.apiKey=null → LlmError «нет API-ключа в llm_providers» (ENV-фолбэк удалён)', async () => {
    const svc = new AnthropicService(makeCfg());

    await expect(
      svc.complete(
        { system: { text: 's' }, user: 'u' },
        { baseUrl: 'https://override.example/v1', apiKey: null },
      ),
    ).rejects.toThrow(/нет API-ключа в llm_providers/);
  });

  it('override отсутствует → используется конструкторский клиент, новый не создаётся', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('constructor sdk not set');
    const constructorSdk = lastSdkInstance;

    await svc.complete({ system: { text: 's' }, user: 'u' });

    expect(lastSdkInstance).toBe(constructorSdk);
  });
});
