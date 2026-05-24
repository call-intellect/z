import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { GrsaiService } from './grsai.service';
import { LlmError } from './llm.types';

/**
 * GrsaiService unit-тесты: SSE-парсер, токены usage, выбор endpoint'а
 * (proxy vs direct), retry-лестница, error handling.
 *
 * Mocking — через `globalThis.fetch` (как в vox.service.spec.ts).
 * SSE-тело отдаём как `ReadableStream<Uint8Array>`, который умеет читать
 * `Response.body.getReader()`. Это тот же путь, что вызовет `collectSse()`.
 */

/** Собирает Response с SSE-телом из набора готовых event-строк. */
function sseResponse(events: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(ev));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeProxyCfg(): TypedConfigService {
  return {
    ai: {
      grsai: {
        apiKey: 'grsai-secret',
        baseUrl: 'https://proxy.agent-lia.ru/v1',
      },
      proxy: {
        baseUrl: 'https://proxy.agent-lia.ru/v1',
        prefix: 'myFeedproxy3128',
      },
    },
  } as unknown as TypedConfigService;
}

function makeDirectCfg(): TypedConfigService {
  return {
    ai: {
      grsai: {
        apiKey: 'grsai-direct',
        baseUrl: 'https://grsaiapi.com',
      },
      proxy: {
        baseUrl: 'https://proxy.agent-lia.ru/v1',
        prefix: 'myFeedproxy3128',
      },
    },
  } as unknown as TypedConfigService;
}

describe('GrsaiService.complete — happy path и форматирование запроса', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.clearAllMocks();
  });

  it('proxy-режим: SSE-чанки склеиваются, usage парсится; URL и auth корректны', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"при"}}]}\n',
      'data: {"choices":[{"delta":{"content":"вет"}}]}\n',
      'data: {"choices":[{"delta":{"content":" мир"}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n',
      'data: [DONE]\n',
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeProxyCfg());
    const out = await svc.complete({
      system: { text: 'sys-text' },
      user: 'user-text',
      model: 'gemini-3-pro',
      maxTokens: 200,
      temperature: 0.3,
    });

    expect(out.text).toBe('привет мир');
    expect(out.inputTokens).toBe(12);
    expect(out.outputTokens).toBe(3);
    expect(out.provider).toBe('grsai');
    expect(out.model).toBe('gemini-3-pro');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    // Когда grsai.baseUrl совпадает с proxy.baseUrl — идём через /grsai/v1/chat/completions
    expect(String(url)).toBe(
      'https://proxy.agent-lia.ru/grsai/v1/chat/completions',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer myFeedproxy3128:grsai-secret');
    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
      max_tokens?: number;
      temperature?: number;
    };
    expect(body.model).toBe('gemini-3-pro');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(200);
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys-text' },
      { role: 'user', content: 'user-text' },
    ]);
  });

  it('direct-режим: baseUrl ≠ proxy → direct URL и Bearer без prefix', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n',
      'data: [DONE]\n',
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeDirectCfg());
    const out = await svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3.1-pro',
    });

    expect(out.text).toBe('hi');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe('https://grsaiapi.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer grsai-direct');
  });

  it('SSE с malformed JSON между валидными — пропускается без падения', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n',
      'data: not-json-broken-line\n',
      'data: {"choices":[{"delta":{"content":"b"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n',
      'data: [DONE]\n',
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeProxyCfg());
    const out = await svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3-pro',
    });
    expect(out.text).toBe('ab');
    expect(out.inputTokens).toBe(5);
    expect(out.outputTokens).toBe(2);
  });

  it('model отсутствует → LlmError, в сеть не идём', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeProxyCfg());
    await expect(
      svc.complete({ system: { text: 's' }, user: 'u' }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GrsaiService.complete — retry/error handling', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('HTTP 400 → LlmError сразу, без retry', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('bad', { status: 400 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeProxyCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3-pro',
    });
    const expectation = expect(promise).rejects.toBeInstanceOf(LlmError);
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 → 3 retry → 4 попытки → LlmError(httpStatus=429)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('rate limited', { status: 429 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeProxyCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3-pro',
    });
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'LlmError',
      httpStatus: 429,
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('HTTP 502 везде → retry до конца → LlmError(httpStatus=502)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('bad gateway', { status: 502 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeProxyCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3-pro',
    });
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'LlmError',
      httpStatus: 502,
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('HTTP 500 → потом 200 — успешный результат за 2 попытки', async () => {
    const successEvents = [
      'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n',
      'data: [DONE]\n',
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream', { status: 500 }))
      .mockResolvedValueOnce(sseResponse(successEvents));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new GrsaiService(makeProxyCfg());
    const promise = svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'gemini-3-pro',
    });
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.text).toBe('ok');
    expect(out.inputTokens).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
