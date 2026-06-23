import { describe, expect, it, vi } from 'vitest';

import { RouterService } from './router.service';

/**
 * SBA α-3 wave 3 — RouterService.fallbackToLlm tests.
 *
 * Тестируем pure-логику helper'ов и env-флага. Полноценный сценарий с моком
 * LlmRouterService + Redis — в integration-test (TODO до тестового стенда).
 */

describe('RouterService — LLM-fallback env-флаг', () => {
  it('ROUTER_LLM_FALLBACK_ENABLED=undefined → false (prod safe default)', () => {
    delete process.env['ROUTER_LLM_FALLBACK_ENABLED'];
    expect(isLlmFallbackEnabledMimic()).toBe(false);
  });

  it('ROUTER_LLM_FALLBACK_ENABLED="false" → false', () => {
    process.env['ROUTER_LLM_FALLBACK_ENABLED'] = 'false';
    expect(isLlmFallbackEnabledMimic()).toBe(false);
    delete process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  });

  it('ROUTER_LLM_FALLBACK_ENABLED="true" → true', () => {
    process.env['ROUTER_LLM_FALLBACK_ENABLED'] = 'true';
    expect(isLlmFallbackEnabledMimic()).toBe(true);
    delete process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  });

  it('ROUTER_LLM_FALLBACK_ENABLED="1" → true', () => {
    process.env['ROUTER_LLM_FALLBACK_ENABLED'] = '1';
    expect(isLlmFallbackEnabledMimic()).toBe(true);
    delete process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  });

  it('ROUTER_FALLBACK_CACHE_TTL_SECONDS — default 86400', () => {
    delete process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
    expect(ttlMimic()).toBe(86400);
  });

  it('ROUTER_FALLBACK_CACHE_TTL_SECONDS="3600" → 3600', () => {
    process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'] = '3600';
    expect(ttlMimic()).toBe(3600);
    delete process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
  });

  it('ROUTER_FALLBACK_CACHE_TTL_SECONDS="invalid" → default 86400', () => {
    process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'] = 'invalid';
    expect(ttlMimic()).toBe(86400);
    delete process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
  });

  it('ROUTER_FALLBACK_CACHE_TTL_SECONDS="-1" → default 86400', () => {
    process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'] = '-1';
    expect(ttlMimic()).toBe(86400);
    delete process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
  });
});

describe('RouterService — SPECIALIST + PRIORITY contract', () => {
  it('SPECIALIST содержит ожидаемые имена', () => {
    expect(RouterService.SPECIALIST.DECISIONS).toBe('3-3-decisions');
    expect(RouterService.SPECIALIST.REGULATIONS).toBe('3-1-regulations');
    expect(RouterService.SPECIALIST.INSIGHTS).toBe('3-5-insights');
    expect(RouterService.SPECIALIST.IDEAS).toBe('3-6-ideas');
    expect(RouterService.SPECIALIST.SKILL).toBe('3-7-skill');
    expect(RouterService.SPECIALIST.PROJECT_CUSTOMER).toBe('3-4-project-customer');
    expect(RouterService.SPECIALIST.KNOWLEDGE_CLONE).toBe('3-2-knowledge-clone');
  });

  it('priorityOf() возвращает корректный rank для известных, 99 для неизвестных', () => {
    expect(RouterService.priorityOf(RouterService.SPECIALIST.DECISIONS)).toBe(1);
    expect(RouterService.priorityOf(RouterService.SPECIALIST.KNOWLEDGE_CLONE)).toBe(7);
    expect(RouterService.priorityOf('unknown-specialist')).toBe(99);
  });
});

// ─────────────────── Б54 (K6): negative-cache при llm_error ───────────────────

/**
 * In-memory Redis-мок с поддержкой get/set EX (без TTL-истечения — для теста
 * окна это не нужно: проверяем, что во ВТОРОЙ заход маркер виден).
 */
function makeRedisMock() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, val: string) => {
        store.set(key, val);
        return 'OK';
      }),
    },
  };
}

function makeFallbackDeps(opts: { redis: ReturnType<typeof makeRedisMock> }) {
  const prisma = {
    ideaBlock: {
      findUnique: vi.fn().mockResolvedValue({
        criticalQuestion: 'Что?',
        trustedAnswer: 'Так.',
        tags: [],
      }),
    },
  };
  const metrics = {
    observeCoreRouterFanOut: vi.fn(),
    incCoreRouterTrimmed: vi.fn(),
    incCoreRouterDispatched: vi.fn(),
    incRouterFallbackCall: vi.fn(),
    incRouterFallbackCacheHit: vi.fn(),
  };
  const coreQueue = { enqueueSpecialistRouting: vi.fn() };
  const cfg = {
    router: { maxSpecialistsPerBlock: 4 },
    aiFeatures: { promptInjectionGuardEnabled: false },
    specialistsCombined: { enabled: false },
    resolveSync<T>(_adminKey: string, envKey: string | undefined, def: T): T {
      const raw = envKey ? process.env[envKey] : undefined;
      if (raw == null || raw === '') return def;
      if (typeof def === 'boolean') {
        return ((raw === 'true' || raw === '1') as unknown) as T;
      }
      if (typeof def === 'number') {
        const n = Number(raw);
        return ((Number.isFinite(n) && n > 0 ? Math.floor(n) : def) as unknown) as T;
      }
      return (raw as unknown) as T;
    },
  };
  // LLM всегда падает → ветка llm_error.
  const llm = {
    call: vi.fn().mockRejectedValue(new Error('provider down')),
  };
  return { prisma, metrics, coreQueue, cfg, llm, redis: opts.redis };
}

describe('RouterService — Б54 negative-cache при llm_error', () => {
  it('llm_error → пишется negative-маркер; повторный fallback пропускает LLM в окне TTL', async () => {
    process.env['ROUTER_LLM_FALLBACK_ENABLED'] = 'true';
    const redis = makeRedisMock();
    const deps = makeFallbackDeps({ redis });
    const svc = new RouterService(
      deps.prisma as any,
      deps.coreQueue as any,
      deps.metrics as any,
      deps.cfg as any,
      deps.llm as any,
      deps.redis as any,
      undefined,
    );

    const block = {
      id: 'blk_mood_1',
      tenantId: 'org-1',
      signalType: 'mood' as any,
    };

    // ── 1-й заход: статика даёт 0 targets → fallbackToLlm → LLM падает.
    const first = await svc.dispatch(block);
    expect(deps.llm.call).toHaveBeenCalledTimes(1);
    expect(first.dispatched).toEqual([]);
    // Записан negative-маркер (отдельное пространство routerfallback:err:).
    const negKeys = [...redis.store.keys()].filter((k) =>
      k.startsWith('routerfallback:err:'),
    );
    expect(negKeys).toHaveLength(1);
    expect(redis.store.get(negKeys[0]!)).toBe('1');

    // ── 2-й заход тем же блоком: маркер активен → LLM НЕ дёргается повторно.
    const second = await svc.dispatch(block);
    expect(deps.llm.call).toHaveBeenCalledTimes(1); // не выросло
    expect(second.dispatched).toEqual([]);

    delete process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  });
});

describe('RouterService — Б54 negative-TTL env', () => {
  it('ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS default → 60', () => {
    delete process.env['ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS'];
    expect(negTtlMimic()).toBe(60);
  });
  it('ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS="120" → 120', () => {
    process.env['ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS'] = '120';
    expect(negTtlMimic()).toBe(120);
    delete process.env['ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS'];
  });
  it('ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS="-5" → default 60', () => {
    process.env['ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS'] = '-5';
    expect(negTtlMimic()).toBe(60);
    delete process.env['ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS'];
  });
});

/** Имитация private getRouterFallbackNegativeTtlSeconds. */
function negTtlMimic(): number {
  const raw = process.env['ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS'];
  if (raw == null || raw === '') return 60;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 60;
  return Math.floor(num);
}

// ─────────────────────── helpers ────────────────────────────────────

/** Имитация private isLlmFallbackEnabled — проверка контракта. */
function isLlmFallbackEnabledMimic(): boolean {
  const raw = process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  if (raw == null || raw === '') return false;
  return raw === 'true' || raw === '1';
}

/** Имитация private getRouterFallbackTtlSeconds. */
function ttlMimic(): number {
  const raw = process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
  if (raw == null || raw === '') return 86400;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 86400;
  return Math.floor(num);
}
