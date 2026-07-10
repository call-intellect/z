import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

let lastSdkInstance: {
  messages: { create: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> };
} | null = null;
let lastSdkCtorOpts: unknown = null;

const DEFAULT_CREATE_RESULT = {
  content: [{ type: 'text', text: '' }],
  usage: { input_tokens: 0, output_tokens: 0 },
};

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages: { create: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> };
      constructor(opts: unknown) {
        lastSdkCtorOpts = opts;
        this.messages = {
          create: vi.fn(async () => DEFAULT_CREATE_RESULT),
          stream: vi.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- тест-фейк: захватываем созданный SDK-инстанс в module-scope для assertions
        lastSdkInstance = this;
      }
    },
  };
});

import { LlmError } from './llm.types';
import { MinimaxService } from './minimax.service';

function makeCfg(): TypedConfigService {
  return {
    ai: {
      minimax: {
        apiKey: 'minimax-test-key',
        baseUrl: 'https://minimax.example/v1',
      },
    },
  } as unknown as TypedConfigService;
}

describe('MinimaxService.complete', () => {
  beforeEach(() => {
    lastSdkInstance = null;
    lastSdkCtorOpts = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('успешный вызов → text + tokens + provider=minimax', async () => {
    const svc = new MinimaxService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    lastSdkInstance.messages.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'привет' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await svc.complete({ system: { text: 'sys' }, user: 'u' });

    expect(result.text).toBe('привет');
    expect(result.provider).toBe('minimax');
    expect(result.model).toBe('MiniMax-M2.5');
  });

  it('ошибка SDK → LlmError с MiniMax-префиксом', async () => {
    const svc = new MinimaxService(makeCfg());
    if (!lastSdkInstance) throw new Error('sdk not set');
    lastSdkInstance.messages.create.mockRejectedValueOnce(new Error('boom'));

    await expect(svc.complete({ system: { text: 's' }, user: 'u' })).rejects.toBeInstanceOf(
      LlmError,
    );
  });
});

describe('MinimaxService.complete: connection-override (Ф3)', () => {
  beforeEach(() => {
    lastSdkInstance = null;
    lastSdkCtorOpts = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('override передан → новый клиент строится с override.baseUrl/apiKey', async () => {
    const svc = new MinimaxService(makeCfg());
    if (!lastSdkInstance) throw new Error('constructor sdk not set');
    const constructorSdk = lastSdkInstance;

    const result = await svc.complete(
      { system: { text: 's' }, user: 'u' },
      { baseUrl: 'https://override.example/v1', apiKey: 'override-key' },
    );

    expect(lastSdkInstance).not.toBe(constructorSdk);
    const capturedOpts = lastSdkCtorOpts as { apiKey?: string; baseURL?: string };
    expect(capturedOpts.baseURL).toBe('https://override.example/v1');
    expect(capturedOpts.apiKey).toBe('override-key');
    expect(result.text).toBe('');
  });

  it('override.apiKey=null → LlmError «нет API-ключа в llm_providers» (ENV-фолбэк удалён)', async () => {
    const svc = new MinimaxService(makeCfg());

    await expect(
      svc.complete(
        { system: { text: 's' }, user: 'u' },
        { baseUrl: 'https://override.example/v1', apiKey: null },
      ),
    ).rejects.toThrow(/нет API-ключа в llm_providers/);
  });

  it('override отсутствует → используется конструкторский клиент', async () => {
    const svc = new MinimaxService(makeCfg());
    if (!lastSdkInstance) throw new Error('constructor sdk not set');
    const constructorSdk = lastSdkInstance;

    await svc.complete({ system: { text: 's' }, user: 'u' });

    expect(lastSdkInstance).toBe(constructorSdk);
  });
});
