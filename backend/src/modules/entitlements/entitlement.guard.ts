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

import { EntitlementService } from './entitlement.service';
import { REQUIRE_ENTITLEMENT_KEY } from './require-entitlement.decorator';
import type { FeatureKey } from './tier-config';

/**
 * EntitlementGuard — глобально зарегистрированный guard (Фаза 12).
 *
 * Алгоритм:
 *   1. Читает метаданные `REQUIRE_ENTITLEMENT_KEY` через Reflector
 *      (handler перекрывает class — стандартное поведение Nest).
 *   2. Если фича не требуется — `return true` (guard прозрачен для эндпоинтов
 *      без `@RequireEntitlement`).
 *   3. Иначе требует `req.tenantId` (его кладёт `TenantGuard`); если нет —
 *      403 `tenant_required`.
 *   4. Резолвит entitlement через `EntitlementService.hasFeature`.
 *   5. На отказ — 403 с телом `{ok: false, error: {code, feature, currentTier,
 *      upgradeUrl}}`. Frontend строит CTA «перейти в /settings/billing».
 *
 * Цепочка guard'ов в проекте: CookieAuthGuard → TenantGuard → EntitlementGuard
 * (этот guard) → RbacGuard. Регистрируется через APP_GUARD в AppModule.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  private readonly logger = new Logger(EntitlementGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      REQUIRE_ENTITLEMENT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!feature) return true;

    // Поддерживаем только HTTP-эндпоинты. WebSocket / RPC не имеют смысла для
    // entitlement-gating (всё равно через REST идёт).
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
            'EntitlementGuard требует TenantGuard выше (req.tenantId не выставлен).',
        },
      });
    }

    const ent = await this.entitlements.getEntitlement(tenantId);
    const enabled = ent.features[feature] === true;
    if (enabled) return true;

    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'entitlement_required',
        message: `Фича '${feature}' не входит в ваш тариф (${ent.tier}).`,
        feature,
        currentTier: ent.tier,
        upgradeUrl: '/settings/billing',
      },
    });
  }
}
