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

    if (ctx.getType() !== 'http') return true;

    const req = ctx.switchToHttp().getRequest<Request & { tenantId?: string }>();

    const tenantId = req.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'EntitlementGuard требует TenantGuard выше (req.tenantId не выставлен).',
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
