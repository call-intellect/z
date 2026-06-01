import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { RbacService } from '../../modules/rbac/rbac.service';

import { PUBLIC_DEMO_KEY } from './public-demo.decorator';

/**
 * DemoObserverGuard — глобальный guard. Режет mutating-эндпоинты (POST/PUT/
 * PATCH/DELETE) для пользователей с ролью `demo_observer` в текущей Org.
 *
 * Архитектура:
 *  - APP_GUARD выполняется ДО method-level TenantGuard. К моменту нашего вызова
 *    req.tenantId уже стоит от TenantMiddleware, req.user.id от CookieAuthGuard.
 *    Сам грузим membership через RbacService.loadContext (в кэше после первого).
 *  - super_admin bypass через cached `req.user.isSuperAdmin` (см. SubscriptionGuard).
 *  - GET/HEAD/OPTIONS пропускаются (read-only).
 *  - BYPASS_PATH_PREFIXES — /billing, /subscription, /auth, /accounts/me, /me/*,
 *    /entitlements/me (личные/служебные эндпоинты).
 *  - @PublicDemo() декоратор — точечное исключение для редких write-эндпоинтов,
 *    которые НЕ мутируют доменные данные (например, concierge/ask).
 *
 * Источник: ТЗ plans/tz/2026-06-01-demo-shared-org-model.md §4.3, Фаза 2.
 */
@Injectable()
export class DemoObserverGuard implements CanActivate {
  private readonly logger = new Logger(DemoObserverGuard.name);

  /** Пути, которые guard НИКОГДА не блокирует (личные/служебные write). */
  private static readonly BYPASS_PATH_PREFIXES = [
    '/api/v1/billing',
    '/api/v1/subscription',
    '/api/v1/auth',
    '/api/v1/accounts/me',
    '/api/v1/me/',
    '/api/v1/entitlements/me',
  ];

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const req = ctx
      .switchToHttp()
      .getRequest<
        Request & {
          tenantId?: string;
          user?: { id?: string; isSuperAdmin?: boolean } | null;
          rbacContext?: { role: string; visibility: string; isSuperAdmin: boolean };
        }
      >();

    // GET/HEAD/OPTIONS — read-only, всегда пропускаем.
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true;
    }

    // BYPASS-пути (billing/auth/personal) — не блокируем write.
    const path = req.path ?? req.url ?? '';
    if (DemoObserverGuard.BYPASS_PATH_PREFIXES.some((p) => path.startsWith(p))) {
      return true;
    }

    // @PublicDemo() — точечное исключение.
    const isPublicDemo = this.reflector.getAllAndOverride<boolean | undefined>(
      PUBLIC_DEMO_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (isPublicDemo === true) return true;

    const user = req.user;
    if (!user || !user.id) return true; // не authenticated — следующие guards разберутся
    if (user.isSuperAdmin === true) return true;

    const tenantId = req.tenantId;
    if (!tenantId) return true; // нет Org-контекста — TenantGuard далее 403

    const rbacCtx = await this.rbac.loadContext(user.id, tenantId);
    if (!rbacCtx) return true; // нет membership — TenantGuard далее 403

    // Кэшируем для downstream guards/handlers.
    req.rbacContext = {
      role: rbacCtx.role,
      visibility: rbacCtx.visibility,
      isSuperAdmin: rbacCtx.isSuperAdmin,
    };

    if (rbacCtx.isSuperAdmin) return true;
    if (this.rbac.canMutate(rbacCtx.role)) return true;

    this.logger.debug(
      { userId: user.id, tenantId, role: rbacCtx.role, method: req.method, path },
      'DemoObserverGuard: mutation blocked',
    );

    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'demo_observer_readonly',
        message:
          'Это демо-кабинет «Демо: ТехноСтрим» — здесь доступен только просмотр. Чтобы создавать данные, переключитесь в свою компанию и оплатите подписку.',
      },
    });
  }
}
