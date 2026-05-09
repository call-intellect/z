import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { VoxService } from './vox.service';
import { VoxError } from './vox.types';

function makeCfg(): TypedConfigService {
  return {
    ai: {
      vox: {
        apiUrl: 'https://vox.test',
        apiToken: 't0ken',
        model: 'v3_rnnt',
        language: 'ru',
        punctuationMode: 'pro',
      },
    },
  } as unknown as TypedConfigService;
}

describe('VoxService.submit', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('успешный submit возвращает taskId', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ taskId: 'task-1' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new VoxService(makeCfg());
    const result = await svc.submit(Buffer.from('audio'));
    expect(result.taskId).toBe('task-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, unknown];
    expect(String(call[0])).toContain('/api/v1/transcription/submit');
  });

  it('на 4xx падает в VoxError после ретраев', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('bad token', { status: 401 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new VoxService(makeCfg());
    const promise = svc.submit(Buffer.from('audio'));
    const expectation = expect(promise).rejects.toBeInstanceOf(VoxError);
    await vi.runAllTimersAsync();
    await expectation;
    // 4 попытки (1 + 3 ретрая) — все ошибки в submit ретраятся одинаково
    // (упрощённое поведение, см. vox.service.ts).
    expect(fetchMock.mock.calls.length).toBe(4);
  });
});

describe('VoxService.poll', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('COMPLETED сразу — отдаёт текст и words', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'COMPLETED',
          transcriptText: 'Привет мир',
          durationSeconds: 1.5,
          words: [
            { word: 'Привет', startMs: 0, endMs: 500 },
            { word: 'мир', startMs: 600, endMs: 900 },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new VoxService(makeCfg());
    const promise = svc.poll('task-1', { intervalMs: 10, maxAttempts: 3 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('COMPLETED');
    expect(result.transcriptText).toBe('Привет мир');
    expect(result.words).toHaveLength(2);
    expect(result.durationSeconds).toBe(1.5);
  });

  it('FAILED — VoxError с errorMessage', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ status: 'FAILED', errorMessage: 'audio_corrupt' }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new VoxService(makeCfg());
    const promise = svc.poll('task-1', { intervalMs: 10, maxAttempts: 3 });
    // attach catch до runAllTimers чтобы не было unhandled rejection
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'VoxError',
      message: expect.stringContaining('audio_corrupt'),
    });
    await vi.runAllTimersAsync();
    await expectation;
  });

  it('таймаут — VoxError при PROCESSING до конца попыток', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'PROCESSING' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new VoxService(makeCfg());
    const promise = svc.poll('task-1', { intervalMs: 5, maxAttempts: 3 });
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'VoxError',
      message: expect.stringContaining('timeout'),
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
