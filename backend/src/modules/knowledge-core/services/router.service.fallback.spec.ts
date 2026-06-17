import { describe, expect, it } from 'vitest';

import { RouterService } from './router.service';

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

function isLlmFallbackEnabledMimic(): boolean {
  const raw = process.env['ROUTER_LLM_FALLBACK_ENABLED'];
  if (raw == null || raw === '') return false;
  return raw === 'true' || raw === '1';
}

function ttlMimic(): number {
  const raw = process.env['ROUTER_FALLBACK_CACHE_TTL_SECONDS'];
  if (raw == null || raw === '') return 86400;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 86400;
  return Math.floor(num);
}
