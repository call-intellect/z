import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

interface FakeChatCompletions {
  create: ReturnType<typeof vi.fn>;
}

let lastClient: { chat: { completions: FakeChatCompletions } } | null = null;
let lastCtorOpts: unknown = null;

const DEFAULT_RESPONSE = {
  choices: [{ message: { content: '' } }],
  usage: { prompt_tokens: 0, completion_tokens: 0 },
};

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat: { completions: FakeChatCompletions };
      constructor(opts: unknown) {
        lastCtorOpts = opts;
        const create = vi.fn(async () => DEFAULT_RESPONSE);
        this.chat = { completions: { create } };
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- тест-фейк: захватываем созданный SDK-инстанс в module-scope для assertions
        lastClient = this;
      }
    },
  };
});

import { LlmError } from './llm.types';
import { OllamaService } from './ollama.service';

function makeCfg(): TypedConfigService {
  return {
    ai: {
      ollama: {
        apiKey: '',
        baseUrl: 'http://ollama.internal:11434/v1',
      },
    },
  } as unknown as TypedConfigService;
}

describe('OllamaService.complete', () => {
  beforeEach(() => {
    lastClient = null;
    lastCtorOpts = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('успешный вызов → text + provider=ollama', async () => {
    const svc = new OllamaService(makeCfg());
    if (!lastClient) throw new Error('client not set');
    lastClient.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: 'привет' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });

    const result = await svc.complete({ system: { text: 's' }, user: 'u' });

    expect(result.text).toBe('привет');
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('qwen3:30b-a3b-instruct-2507');
  });

  it('apiKey пустой в ENV → конструктор использует "no-key"', () => {
    new OllamaService(makeCfg());
    const opts = lastCtorOpts as { apiKey?: string };
    expect(opts.apiKey).toBe('no-key');
  });

  it('HTTP 500 трижды → retry исчерпан → LlmError', async () => {
    vi.useFakeTimers();
    const svc = new OllamaService(makeCfg());
    if (!lastClient) throw new Error('client not set');
    const err500 = Object.assign(new Error('upstream'), { status: 500 });
    lastClient.chat.completions.create.mockRejectedValue(err500);

    const promise = svc.complete({ system: { text: 's' }, user: 'u' });
    const expectation = expect(promise).rejects.toBeInstanceOf(LlmError);
    await vi.runAllTimersAsync();
    await expectation;
    expect(lastClient.chat.completions.create).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});

describe('OllamaService.complete: connection-override (Ф3)', () => {
  beforeEach(() => {
    lastClient = null;
    lastCtorOpts = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('override передан → новый клиент строится с override.baseUrl/apiKey', async () => {
    const svc = new OllamaService(makeCfg());
    if (!lastClient) throw new Error('constructor client not set');
    const constructorClient = lastClient;

    const result = await svc.complete(
      { system: { text: 's' }, user: 'u' },
      { baseUrl: 'https://override.example/v1', apiKey: 'override-key' },
    );

    expect(lastClient).not.toBe(constructorClient);
    const opts = lastCtorOpts as { apiKey?: string; baseURL?: string };
    expect(opts.baseURL).toBe('https://override.example/v1');
    expect(opts.apiKey).toBe('override-key');
    expect(result.text).toBe('');
  });

  it('override.apiKey=null → fallback на "no-key"', async () => {
    const svc = new OllamaService(makeCfg());

    await svc.complete(
      { system: { text: 's' }, user: 'u' },
      { baseUrl: 'https://override.example/v1', apiKey: null },
    );

    const opts = lastCtorOpts as { apiKey?: string; baseURL?: string };
    expect(opts.baseURL).toBe('https://override.example/v1');
    expect(opts.apiKey).toBe('no-key');
  });

  it('override отсутствует → используется конструкторский клиент', async () => {
    const svc = new OllamaService(makeCfg());
    if (!lastClient) throw new Error('constructor client not set');
    const constructorClient = lastClient;

    await svc.complete({ system: { text: 's' }, user: 'u' });

    expect(lastClient).toBe(constructorClient);
  });
});
