import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { KieService } from './kie.service';
import { LlmError } from './llm.types';

function makeCfg(): TypedConfigService {
  return {
    ai: {
      kie: {
        apiKey: 'kie-test-key',
        baseUrl: 'https://api.kie.ai',
      },
    },
  } as unknown as TypedConfigService;
}

describe('KieService.complete — диспатч по префиксу модели', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.clearAllMocks();
  });

  it('claude-* → Claude-format (POST /claude/v1/messages, парсит content[text])', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'привет от Claude' }],
            usage: { input_tokens: 42, output_tokens: 7 },
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const out = await svc.complete({
      system: { text: 'Ты помощник' },
      user: 'Скажи привет',
      model: 'claude-opus-4-7',
      maxTokens: 100,
    });

    expect(out.text).toBe('привет от Claude');
    expect(out.inputTokens).toBe(42);
    expect(out.outputTokens).toBe(7);
    expect(out.provider).toBe('kie');
    expect(out.model).toBe('claude-opus-4-7');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://api.kie.ai/claude/v1/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer kie-test-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('claude-opus-4-7');
    expect(body.max_tokens).toBe(100);
    expect(body.stream).toBe(false);
    expect(body.messages[0]?.role).toBe('user');
    expect(body.messages[0]?.content).toContain('Ты помощник');
    expect(body.messages[0]?.content).toContain('Скажи привет');
  });

  it('gpt-* → GPT-format (POST /codex/v1/responses, парсит output[message].content[output_text])', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              { type: 'reasoning', content: [] },
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'gpt-ответ' }],
              },
            ],
            usage: { input_tokens: 13, output_tokens: 5 },
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const out = await svc.complete({
      system: { text: 'sys' },
      user: 'u',
      model: 'gpt-5-4',
      reasoningEffort: 'medium',
    });

    expect(out.text).toBe('gpt-ответ');
    expect(out.inputTokens).toBe(13);
    expect(out.outputTokens).toBe(5);
    expect(out.provider).toBe('kie');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://api.kie.ai/codex/v1/responses');
    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      input: Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;
      reasoning?: { effort: string };
    };
    expect(body.model).toBe('gpt-5-4');
    expect(body.stream).toBe(false);
    expect(body.input[0]?.role).toBe('user');
    expect(body.input[0]?.content[0]?.type).toBe('input_text');
    expect(body.reasoning?.effort).toBe('medium');
  });

  it('gemini-* → Gemini direct-format (модель в URL, в body нет `model`)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'gemini-ответ' } }],
            usage: { prompt_tokens: 99, completion_tokens: 11 },
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const out = await svc.complete({
      system: { text: 'sys' },
      user: 'u',
      model: 'gemini-3-flash',
      maxTokens: 50,
    });

    expect(out.text).toBe('gemini-ответ');
    expect(out.inputTokens).toBe(99);
    expect(out.outputTokens).toBe(11);
    expect(out.provider).toBe('kie');
    expect(out.model).toBe('gemini-3-flash');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://api.kie.ai/gemini-3-flash/v1/chat/completions');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBeUndefined();
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(50);
    expect(body.include_thoughts).toBe(false);
  });

  it('Gemini: content как массив частей → склеивается в текст', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [{ text: 'part-1 ' }, { text: 'part-2' }],
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const out = await svc.complete({
      system: { text: 'sys' },
      user: 'u',
      model: 'gemini-3-pro',
    });

    expect(out.text).toBe('part-1 part-2');
  });

  it('model отсутствует → LlmError с понятным сообщением', async () => {
    const svc = new KieService(makeCfg());
    await expect(svc.complete({ system: { text: 's' }, user: 'u' })).rejects.toBeInstanceOf(
      LlmError,
    );
  });

  it('неизвестный префикс модели → LlmError (не уходит в сеть)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    await expect(
      svc.complete({
        system: { text: 's' },
        user: 'u',
        model: 'mistral-large',
      }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('KieService.complete — retry/error handling', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('HTTP 4xx (не 429) → LlmError сразу, без retry', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3-flash',
    });
    const expectation = expect(promise).rejects.toBeInstanceOf(LlmError);
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 → 3 retry → 4 попытки → LlmError с httpStatus=429', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'claude-opus-4-7',
    });
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'LlmError',
      httpStatus: 429,
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('HTTP 500 → retry → если все попытки fail → LlmError с httpStatus=500', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream error', { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gpt-5-4',
    });
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'LlmError',
      httpStatus: 500,
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('HTTP 503 один раз, потом 200 → возвращает результат после 1 retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('overloaded', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new KieService(makeCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3-pro',
    });
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
