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
 * Алгоритм:
 *   1. Читает метаданные `REQUIRE_SUBSCRIPTION_KEY` через Reflector
 *      (handler перекрывает class — стандартное поведение Nest).
 *   2. Если декоратора нет — `return true` (guard прозрачен для эндпоинтов
 *      без `@RequireSubscription`).
 *   3. Иначе требует `req.tenantId` (его кладёт `TenantGuard`); если нет —
 *      403 `tenant_required`.
 *   4. Получает `Subscription` через `SubscriptionService.getByTenant`.
 *   5. Если `status === 'ACTIVE'` — пропускает.
 *   6. Иначе — 403 `subscription_required` с текущим статусом и ценой.
 *
 * Цепочка guard'ов в проекте: CookieAuthGuard → TenantGuard →
 * SubscriptionGuard (этот guard) → EntitlementGuard → RbacGuard.
 * Регистрируется через APP_GUARD в AppModule.
 *
 * Источник: plans/tz/2026-05-28-paywall-no-trial.md §3.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

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
