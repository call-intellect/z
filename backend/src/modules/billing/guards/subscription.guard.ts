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

import { SubscriptionService } from '../services/subscription.service';

import { REQUIRE_SUBSCRIPTION_KEY } from './require-subscription.decorator';

/**
 * SubscriptionGuard — глобально зарегистрированный guard (paywall без trial).
 *
 * Источник: plans/tz/2026-05-28-paywall-no-trial.md §3.
 *
 * Цепочка guard'ов: CookieAuthGuard → TenantGuard → SubscriptionGuard →
 * EntitlementGuard → RbacGuard. Регистрируется через APP_GUARD в AppModule.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  /** Пути, которые guard НИКОГДА не блокирует (ТЗ §3.2 — оплата и просмотр подписки). */
  private static readonly BYPASS_PATH_PREFIXES = [
    '/api/v1/billing',
    '/api/v1/subscription',
    '/api/v1/auth',
  ];

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_SUBSCRIPTION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    if (ctx.getType() !== 'http') return true;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { tenantId?: string }>();

    // ТЗ §3.2: GET-запросы (read-only) пропускаются — DEMO видит данные.
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true;
    }

    // ТЗ §3.2: /billing/*, /subscription/*, /auth/* — без paywall (оплата/логин).
    const path = req.path ?? req.url ?? '';
    if (SubscriptionGuard.BYPASS_PATH_PREFIXES.some((p) => path.startsWith(p))) {
      return true;
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'tenant_required',
          message:
            'SubscriptionGuard требует TenantGuard выше (req.tenantId не выставлен).',
        },
      });
    }

    const sub = await this.subscriptions.getByTenant(tenantId);
    if (sub?.status === 'ACTIVE') return true;

    const currentStatus = sub?.status ?? 'DEMO';

    this.logger.debug(
      { tenantId, status: currentStatus },
      'SubscriptionGuard: блокировка — подписка не активна',
    );

    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'subscription_required',
        message: 'Оплатите подписку, чтобы начать работу',
        currentStatus,
        price: 60_000,
        currency: 'RUB',
        paymentUrl: '/settings/subscription',
      },
    });
  }
}
