import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

// Контролируем экземпляр SDK через мок: модуль возвращает класс, чей
// конструктор сохраняет moudulewide ссылку на инстанс с замоканным `messages`.
let lastSdkInstance: { messages: { create: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> } } | null = null;

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages: { create: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> };
      constructor(_opts: unknown) {
        this.messages = {
          create: vi.fn(),
          stream: vi.fn(),
        };
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
    // Пересоздание выше вернуло новый sdk; используем lastSdkInstance актуального.
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

    await expect(
      svc.complete({ system: { text: 's' }, user: 'u' }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(sdk.messages.create).not.toHaveBeenCalled();
  });

  it('tool_use возвращается в toolCalls', async () => {
    const svc = new AnthropicService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    const sdk = lastSdkInstance;
    sdk.messages.stream.mockReturnValueOnce({
      finalMessage: async () => ({
        content: [
          { type: 'tool_use', name: 'extract_x', input: { foo: 'bar' } },
        ],
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
