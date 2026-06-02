import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextService } from './request-context.service';

/**
 * LoggingModule — оборачивает каждый HTTP-запрос в `AsyncLocalStorage`-контекст.
 *
 * Регистрируется ПОСЛЕ `RequestIdMiddleware` (нужен `req.id`) и ПЕРЕД
 * `TenantMiddleware`/guards, чтобы они выполнялись внутри контекста и
 * `getOrgId`/`getUserId` читали уже выставленные значения.
 *
 * Геттеры ленивые: `req.user` (CookieAuthGuard) и `req.tenantId`
 * (TenantMiddleware) появляются позже по цепочке.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly ctx: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const r = req as Request & {
      user?: { id?: string; role?: string; isSuperAdmin?: boolean } | null;
      tenantId?: string;
    };
    this.ctx.run(
      {
        requestId: typeof r.id === 'string' ? r.id : undefined,
        route: r.originalUrl,
        getUserId: () => r.user?.id,
        getUserRole: () =>
          r.user?.role ?? (r.user?.isSuperAdmin ? 'super_admin' : undefined),
        getOrgId: () => r.tenantId,
      },
      () => next(),
    );
  }
}
