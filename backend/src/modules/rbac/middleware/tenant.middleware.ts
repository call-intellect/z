import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * TenantMiddleware — выставляет `req.tenantId` ДО глобальных guards (Subscription/
 * Entitlement), чтобы они могли работать на эндпоинтах с @RequireEntitlement /
 * @RequireSubscription декоратором.
 *
 * Алгоритм (точно как `TenantGuard.resolveTenantId`, кроме single-org fallback):
 *   1. Заголовок `X-Org-Id`.
 *   2. URL-параметр `:orgId` (если уже распарсен — Nest парсит до middleware
 *      для матчинга, но `req.params` обычно ещё пуст; читаем из URL вручную).
 *   3. body.tenantId / body.orgId.
 *
 * Single-org fallback (один SELECT в БД) остаётся в TenantGuard — там уже есть
 * `req.user.id` после CookieAuthGuard.
 *
 * Middleware:
 *   - НЕ бросает исключений (если резолв не удался — `req.tenantId` undefined,
 *     далее SubscriptionGuard/EntitlementGuard сами бросят 403, либо TenantGuard
 *     добьёт single-org fallback).
 *   - НЕ делает БД-запросов (нет `req.user`).
 *   - Регистрируется в `AppModule.configure` для `api/v1/*`.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const tenantId = this.resolve(req);
    if (tenantId) {
      (req as Request & { tenantId?: string }).tenantId = tenantId;
    }
    next();
  }

  private resolve(req: Request): string | null {
    // 1. X-Org-Id header
    const headerVal = req.headers['x-org-id'];
    if (typeof headerVal === 'string' && headerVal.trim().length > 0) {
      return headerVal.trim();
    }

    // 2. :orgId URL param. На стадии middleware Nest ещё не выполнил
    //    route-matching, поэтому req.params обычно пуст. Парсим вручную
    //    короткие сегменты вида /api/v1/orgs/:orgId/...
    //    Поддерживаем строго: /api/v1/orgs/<uuid>/...
    const orgIdFromUrl = this.parseOrgIdFromUrl(req.url ?? '');
    if (orgIdFromUrl) return orgIdFromUrl;

    // 3. body.tenantId / body.orgId. На стадии middleware body уже распарсен
    //    (express.json() работает ДО RequestIdMiddleware — оба идут до guards).
    const body = (req as Request & { body?: Record<string, unknown> }).body;
    if (body) {
      const t = body['tenantId'];
      const o = body['orgId'];
      if (typeof t === 'string' && t.length > 0) return t;
      if (typeof o === 'string' && o.length > 0) return o;
    }
    return null;
  }

  /**
   * Извлекает orgId из URL вида `/api/v1/orgs/<id>/...`.
   * Поддерживаем cuid/uuid (буквы, цифры, дефис, подчёркивание, длина 6-64).
   * Не пытаемся валидировать формат строго — это работа downstream-логики.
   */
  private parseOrgIdFromUrl(url: string): string | null {
    // Отрезаем query string.
    const path = url.split('?')[0] ?? '';
    const match = path.match(/^\/api\/v1\/orgs\/([A-Za-z0-9_-]{6,64})(?:\/|$)/);
    return match?.[1] ?? null;
  }
}
