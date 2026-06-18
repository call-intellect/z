import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AnswerCacheService, type AnswerCacheEntry } from './answer-cache.service';

describe('AnswerCacheService', () => {
  let store: Map<string, string>;
  let redisStub: {
    client: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      scan: ReturnType<typeof vi.fn>;
      del: ReturnType<typeof vi.fn>;
    };
  };
  let metrics: {
    incAnswerCacheHit: ReturnType<typeof vi.fn>;
  };
  let cfg: { dialogLayer: { answerCacheTtlSeconds: number } };
  let svc: AnswerCacheService;

  beforeEach(() => {
    store = new Map();
    redisStub = {
      client: {
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        set: vi.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
        scan: vi.fn(async (_cursor: string, _m: string, pattern: string) => {
          const keys = [...store.keys()].filter((k) =>
            new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(k),
          );
          return ['0', keys];
        }),
        del: vi.fn(async (...keys: string[]) => {
          let n = 0;
          for (const k of keys) {
            if (store.delete(k)) n++;
          }
          return n;
        }),
      },
    };
    metrics = { incAnswerCacheHit: vi.fn() };
    cfg = { dialogLayer: { answerCacheTtlSeconds: 86_400 } };
    svc = new AnswerCacheService(
      redisStub as unknown as never,
      cfg as unknown as never,
      metrics as unknown as never,
    );
  });

  const sampleEntry: AnswerCacheEntry = {
    text: 'Бюджет на маркетинг — 1.5М руб.',
    citations: [{ meetingId: 'm1', startMs: 0, endMs: 1000, snippet: 'q' }],
    uncertaintyNote: null,
    mode: 'synthetic',
    usedBlockIds: ['b1', 'b2'],
    cachedAt: new Date().toISOString(),
  };

  it('buildKey стабилен для идентичных аргументов', () => {
    const a = svc.buildKey({
      tenantId: 't1',
      userId: 'u1',
      standaloneQuestion: 'Какой бюджет на маркетинг?',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    });
    const b = svc.buildKey({
      tenantId: 't1',
      userId: 'u1',
      standaloneQuestion: 'Какой бюджет на маркетинг?',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    });
    expect(a).toBe(b);
  });

  it('miss возвращает null', async () => {
    const result = await svc.get({
      tenantId: 't1',
      userId: 'u1',
      standaloneQuestion: 'q',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    });
    expect(result).toBeNull();
    expect(metrics.incAnswerCacheHit).not.toHaveBeenCalled();
  });

  it('set→get возвращает ту же запись (3 идентичных запроса → 3 HIT после первого SET)', async () => {
    const args = {
      tenantId: 't1',
      userId: 'u1',
      standaloneQuestion: 'Сколько денег на маркетинг?',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    };
    await svc.set(args, sampleEntry);

    const r1 = await svc.get(args);
    const r2 = await svc.get(args);
    const r3 = await svc.get(args);
    expect(r1?.text).toBe(sampleEntry.text);
    expect(r2?.text).toBe(sampleEntry.text);
    expect(r3?.text).toBe(sampleEntry.text);
    expect(metrics.incAnswerCacheHit).toHaveBeenCalledTimes(3);
  });

  it('разные standaloneQuestion → разные ключи (miss)', async () => {
    const a = {
      tenantId: 't1',
      userId: 'u1',
      standaloneQuestion: 'Какой бюджет?',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    };
    const b = { ...a, standaloneQuestion: 'Какие задачи?' };
    await svc.set(a, sampleEntry);
    expect(await svc.get(b)).toBeNull();
  });

  it('разные validAt → разные ключи', async () => {
    const base = {
      tenantId: 't1',
      userId: 'u1',
      standaloneQuestion: 'Что мы знали?',
      scope: 'org',
      scopeRefId: null,
    };
    await svc.set({ ...base, validAt: null }, sampleEntry);
    expect(await svc.get({ ...base, validAt: '2025-01-01T00:00:00Z' })).toBeNull();
  });

  it("invalidateTenant удаляет ВСЕ ключи tenant'а", async () => {
    const args1 = {
      tenantId: 't1',
      userId: 'u1',
      standaloneQuestion: 'Q1',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    };
    const args2 = {
      tenantId: 't1',
      userId: 'u2',
      standaloneQuestion: 'Q2',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    };
    const argsOther = {
      tenantId: 't2',
      userId: 'u1',
      standaloneQuestion: 'Q3',
      scope: 'org',
      scopeRefId: null,
      validAt: null,
    };
    await svc.set(args1, sampleEntry);
    await svc.set(args2, sampleEntry);
    await svc.set(argsOther, sampleEntry);

    const deleted = await svc.invalidateTenant('t1');
    expect(deleted).toBe(2);
    expect(await svc.get(args1)).toBeNull();
    expect(await svc.get(args2)).toBeNull();
    expect(await svc.get(argsOther)).not.toBeNull();
  });
});
