/**
 * Регрессия на баг «встречу невозможно создать» (403 tenant_required, 2026-06-03).
 *
 * Мутирующие @RequireSubscription эндпоинты на бэке гейтятся глобальным
 * SubscriptionGuard, который резолвит tenant ТОЛЬКО из X-Org-Id (он global
 * APP_GUARD, выполняется до controller-scoped CookieAuthGuard → req.user
 * недоступен, single-org fallback не работает). api-client обязан добавлять
 * X-Org-Id по умолчанию из текущей Org (setApiClientOrgId), а явный per-call
 * заголовок (admin cross-org) — иметь приоритет.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, setApiClientOrgId } from './api-client';

function captureFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });
  return calls;
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers as HeadersInit).get(name);
}

describe('ApiClient — X-Org-Id по умолчанию', () => {
  const client = new ApiClient('http://test');

  beforeEach(() => {
    vi.restoreAllMocks();
    setApiClientOrgId(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setApiClientOrgId(null);
  });

  it('orgId задан → POST несёт X-Org-Id (чинит создание встречи)', async () => {
    const calls = captureFetch();
    setApiClientOrgId('org_abc');
    await client.post('/api/v1/meetings', { title: 'x' });

    expect(header(calls[0].init, 'X-Org-Id')).toBe('org_abc');
  });

  it('orgId не задан → без X-Org-Id', async () => {
    const calls = captureFetch();
    await client.post('/api/v1/meetings', { title: 'x' });

    expect(header(calls[0].init, 'X-Org-Id')).toBeNull();
  });

  it('явный per-call X-Org-Id имеет приоритет над дефолтом (admin cross-org)', async () => {
    const calls = captureFetch();
    setApiClientOrgId('org_default');
    await client.post('/api/v1/admin/x', {}, { headers: { 'X-Org-Id': 'org_target' } });

    expect(header(calls[0].init, 'X-Org-Id')).toBe('org_target');
  });

  it('применяется и к GET (read-only org-scoped запросы)', async () => {
    const calls = captureFetch();
    setApiClientOrgId('org_abc');
    await client.get('/api/v1/intake');

    expect(header(calls[0].init, 'X-Org-Id')).toBe('org_abc');
  });
});
