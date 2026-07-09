import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { ensureJsonHint, OpenAiProxyService } from './openai-proxy.service';

describe('ensureJsonHint', () => {
  it('добавляет суффикс с "JSON", если слова json в инструкциях нет', () => {
    const input = 'Ты ассистент. Сформулируй краткий ответ.';
    const result = ensureJsonHint(input);

    expect(result).not.toBe(input);
    expect(result.startsWith(input)).toBe(true);
    expect(/json/i.test(result)).toBe(true);
    expect(result).toContain('JSON');
  });

  it('возвращает инструкции без изменений, если слово json уже есть (любой регистр)', () => {
    const lower = 'Верни json-объект с полями.';
    const upper = 'Return JSON object with fields.';
    const mixed = 'Ответ в формате Json.';

    expect(ensureJsonHint(lower)).toBe(lower);
    expect(ensureJsonHint(upper)).toBe(upper);
    expect(ensureJsonHint(mixed)).toBe(mixed);
  });

  it('идемпотентна: повторное применение не дублирует суффикс', () => {
    const input = 'Ты ассистент. Сформулируй краткий ответ.';
    const once = ensureJsonHint(input);
    const twice = ensureJsonHint(once);

    expect(twice).toBe(once);
  });
});

interface FakeResponses {
  create: ReturnType<typeof vi.fn>;
}

let lastClient: { responses: FakeResponses } | null = null;
let lastCtorOpts: unknown = null;

const DEFAULT_RESPONSE = {
  output_text: '',
  output: [],
  usage: { input_tokens: 0, output_tokens: 0 },
};

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      responses: FakeResponses;
      constructor(opts: unknown) {
        lastCtorOpts = opts;
        const create = vi.fn(async () => DEFAULT_RESPONSE);
        this.responses = { create };
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- тест-фейк: захватываем созданный SDK-инстанс в module-scope для assertions
        lastClient = this;
      }
    },
  };
});

function makeCfg(): TypedConfigService {
  return {
    ai: {
      proxy: {
        baseUrl: 'https://proxy.internal/v1',
        prefix: 'testprefix',
      },
      openai: {
        apiKey: 'env-openai-key',
      },
    },
  } as unknown as TypedConfigService;
}

describe('OpenAiProxyService.complete: connection-override (Ф4)', () => {
  beforeEach(() => {
    lastClient = null;
    lastCtorOpts = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('override передан → новый клиент строится с override.baseUrl/apiKey (вместо ENV-дефолта)', async () => {
    const svc = new OpenAiProxyService(makeCfg());
    if (!lastClient) throw new Error('constructor client not set');
    const constructorClient = lastClient;

    await svc.complete(
      { system: { text: 's' }, user: 'u' },
      { baseUrl: 'https://override.example/v1', apiKey: 'override-key' },
    );

    expect(lastClient).not.toBe(constructorClient);
    const opts = lastCtorOpts as { apiKey?: string; baseURL?: string };
    expect(opts.baseURL).toBe('https://override.example/v1');
    expect(opts.apiKey).toBe('override-key');
  });

  it('override.apiKey=null → LlmError «нет API-ключа в llm_providers» (ENV-фолбэк удалён)', async () => {
    const svc = new OpenAiProxyService(makeCfg());

    await expect(
      svc.complete(
        { system: { text: 's' }, user: 'u' },
        { baseUrl: 'https://override.example/v1', apiKey: null },
      ),
    ).rejects.toThrow(/нет API-ключа в llm_providers/);
  });

  it('override отсутствует → используется конструкторский клиент (ENV, как раньше)', async () => {
    const svc = new OpenAiProxyService(makeCfg());
    if (!lastClient) throw new Error('constructor client not set');
    const constructorClient = lastClient;

    await svc.complete({ system: { text: 's' }, user: 'u' });

    expect(lastClient).toBe(constructorClient);
    const opts = lastCtorOpts as { apiKey?: string; baseURL?: string };
    expect(opts.apiKey).toBe('testprefix:env-openai-key');
  });
});
