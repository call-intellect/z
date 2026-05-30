/**
 * TenantMiddleware unit-tests (Pulse Фаза 1.0.1).
 *
 * Покрываем все 3 стратегии резолва tenantId (header / URL / body) +
 * fallback-поведение (next() всегда вызывается, не бросает исключений).
 *
 * БД и пользовательский контекст здесь не нужны — middleware работает
 * синхронно, без зависимостей.
 */
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { TenantMiddleware } from './tenant.middleware';

type MutableReq = Request & { tenantId?: string };

function buildReq(opts: {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
}): MutableReq {
  return {
    url: opts.url ?? '/api/v1/dashboard/director',
    headers: opts.headers ?? {},
    body: opts.body,
  } as unknown as MutableReq;
}

describe('TenantMiddleware', () => {
  const mw = new TenantMiddleware();

  it('ставит req.tenantId из заголовка X-Org-Id', () => {
    const req = buildReq({ headers: { 'x-org-id': 'org-from-header' } });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('org-from-header');
    expect(next).toHaveBeenCalledOnce();
  });

  it('обрезает пробелы вокруг X-Org-Id', () => {
    const req = buildReq({ headers: { 'x-org-id': '  org-with-space  ' } });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('org-with-space');
  });

  it('пустой X-Org-Id игнорируется → продолжает резолв', () => {
    const req = buildReq({
      headers: { 'x-org-id': '   ' },
      body: { tenantId: 'org-from-body' },
    });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('org-from-body');
    expect(next).toHaveBeenCalledOnce();
  });

  it('парсит orgId из URL /api/v1/orgs/<id>/...', () => {
    const req = buildReq({
      url: '/api/v1/orgs/abc123xyz/meetings',
    });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('abc123xyz');
    expect(next).toHaveBeenCalledOnce();
  });

  it('парсит orgId из URL с query string', () => {
    const req = buildReq({
      url: '/api/v1/orgs/cuid_abc-123/?from=widget',
    });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('cuid_abc-123');
  });

  it('URL без префикса /api/v1/orgs/ → tenantId не выставлен (никаких исключений)', () => {
    const req = buildReq({ url: '/api/v1/dashboard/director' });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('использует body.tenantId, если нет ни header ни URL', () => {
    const req = buildReq({ body: { tenantId: 'body-tenant-id' } });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('body-tenant-id');
  });

  it('использует body.orgId как fallback к body.tenantId', () => {
    const req = buildReq({ body: { orgId: 'body-org-id' } });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('body-org-id');
  });

  it('body.tenantId приоритетнее body.orgId', () => {
    const req = buildReq({
      body: { tenantId: 'body-tenant', orgId: 'body-org' },
    });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('body-tenant');
  });

  it('header приоритетнее body', () => {
    const req = buildReq({
      headers: { 'x-org-id': 'header-org' },
      body: { tenantId: 'body-tenant' },
    });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBe('header-org');
  });

  it('URL приоритетнее body, но header приоритетнее URL', () => {
    const reqHeaderWins = buildReq({
      url: '/api/v1/orgs/url-org-id/foo',
      headers: { 'x-org-id': 'header-org' },
      body: { tenantId: 'body-tenant' },
    });
    const next = vi.fn();
    mw.use(reqHeaderWins, {} as Response, next as NextFunction);
    expect(reqHeaderWins.tenantId).toBe('header-org');

    const reqUrlWins = buildReq({
      url: '/api/v1/orgs/url-org-id/foo',
      body: { tenantId: 'body-tenant' },
    });
    const next2 = vi.fn();
    mw.use(reqUrlWins, {} as Response, next2 as NextFunction);
    expect(reqUrlWins.tenantId).toBe('url-org-id');
  });

  it('next() вызывается даже когда tenantId не разрезолвлен', () => {
    const req = buildReq({});
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('не падает на отсутствующем req.body', () => {
    const req = {
      url: '/api/v1/dashboard/director',
      headers: {},
    } as unknown as MutableReq;
    const next = vi.fn();

    expect(() => mw.use(req, {} as Response, next as NextFunction)).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
    expect(req.tenantId).toBeUndefined();
  });

  it('игнорирует слишком короткий orgId в URL (< 6 символов)', () => {
    const req = buildReq({ url: '/api/v1/orgs/abc/foo' });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('массив в X-Org-Id (странный кейс) — игнорируется', () => {
    const req = buildReq({
      headers: { 'x-org-id': ['org-a', 'org-b'] },
      body: { tenantId: 'body-tenant' },
    });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    // Массив не строка → пропускаем → body.tenantId.
    expect(req.tenantId).toBe('body-tenant');
  });

  it('body.tenantId не строка — пропускаем', () => {
    const req = buildReq({ body: { tenantId: 12345 } });
    const next = vi.fn();

    mw.use(req, {} as Response, next as NextFunction);

    expect(req.tenantId).toBeUndefined();
  });
});
