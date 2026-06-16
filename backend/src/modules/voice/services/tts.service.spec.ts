import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { TtsError, TtsService, TTS_MAX_CHARS } from './tts.service';

function makeCfg(overrides?: {
  ttsProvider?: 'openai' | 'yandex';
  ttsVoice?: string;
}): TypedConfigService {
  return {
    ai: {
      proxy: { baseUrl: 'https://proxy.test/v1', prefix: 'prefix' },
      openai: { apiKey: 'sk-test', baseUrl: 'https://api.openai.test/v1' },
    },
    voice: {
      ttsProvider: overrides?.ttsProvider ?? 'openai',
      ttsVoice: overrides?.ttsVoice ?? 'alloy',
      wsEnabled: true,
    },
  } as unknown as TypedConfigService;
}

describe('TtsService.synthesize', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {});
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('успешный synthesize через openai возвращает audio Buffer', async () => {
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00]);
    const fetchMock = vi.fn(
      async () =>
        new Response(audioBytes.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new TtsService(makeCfg());
    const result = await svc.synthesize({ text: 'Привет, мир' });

    expect(result.provider).toBe('openai');
    expect(result.voice).toBe('alloy');
    expect(result.bytes).toBe(audioBytes.byteLength);
    expect(result.chars).toBe('Привет, мир'.length);
    expect(Buffer.isBuffer(result.audio)).toBe(true);
    expect(result.audio.byteLength).toBe(audioBytes.byteLength);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(String(call[0])).toContain('/audio/speech');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Authorization']).toBe('Bearer prefix:sk-test');
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body['voice']).toBe('alloy');
    expect(body['input']).toBe('Привет, мир');
    expect(body['response_format']).toBe('mp3');
  });

  it('voice override применяется к запросу', async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([1]).buffer as ArrayBuffer, { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new TtsService(makeCfg());
    const result = await svc.synthesize({ text: 'Hi', voice: 'nova' });

    expect(result.voice).toBe('nova');
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body['voice']).toBe('nova');
  });

  it('пустой text падает в TtsError(text_empty)', async () => {
    const svc = new TtsService(makeCfg());
    await expect(svc.synthesize({ text: '   ' })).rejects.toBeInstanceOf(TtsError);
    await expect(svc.synthesize({ text: '' })).rejects.toMatchObject({
      message: 'text_empty',
    });
  });

  it('text длиннее TTS_MAX_CHARS падает в TtsError(text_too_long:N)', async () => {
    const svc = new TtsService(makeCfg());
    const big = 'a'.repeat(TTS_MAX_CHARS + 1);
    await expect(svc.synthesize({ text: big })).rejects.toMatchObject({
      message: `text_too_long:${TTS_MAX_CHARS + 1}`,
    });
  });

  it('yandex provider — отказ с TtsError(yandex_not_configured)', async () => {
    const svc = new TtsService(makeCfg({ ttsProvider: 'yandex' }));
    await expect(svc.synthesize({ text: 'hi' })).rejects.toMatchObject({
      message: 'yandex_not_configured',
    });
  });

  it('non-OK ответ openai падает в TtsError(openai_http_<status>:...)', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new TtsService(makeCfg());
    await expect(svc.synthesize({ text: 'hello' })).rejects.toMatchObject({
      message: expect.stringContaining('openai_http_429') as unknown as string,
    });
  });

  it('network error падает в TtsError(openai_network:...)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new TtsService(makeCfg());
    await expect(svc.synthesize({ text: 'hello' })).rejects.toMatchObject({
      message: expect.stringContaining('openai_network') as unknown as string,
    });
  });
});
