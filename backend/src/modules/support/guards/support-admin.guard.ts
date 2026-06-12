import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { RbacService } from '../../rbac/rbac.service';
import { SupportAccessService } from '../services/support-access.service';

/**
 * SupportAdminGuard — пускает в admin-API поддержки (галочка + засев контура)
 * ТОЛЬКО владельца вендор-Org или супер-админа (Р-7, ТЗ 2026-06-09 support-desk
 * Ф2). Подключается ПОСЛЕ CookieAuthGuard.
 *
 * Алгоритм:
 *   1. Нет `req.user` → 403 `no_user`.
 *   2. `getVendorOrgId()` пуст → 403 `SUPPORT_DESK_DISABLED` (деск не настроен).
 *   3. `RbacService.loadContext(user.id, vendorOrgId)` → пускаем, если
 *      `isSuperAdmin || role==='owner'`; иначе 403 `SUPPORT_ADMIN_REQUIRED`.
 *   4. Кладёт `req.tenantId = vendorOrgId` (admin всегда работает в вендор-Org).
 */
@Injectable()
export class SupportAdminGuard implements CanActivate {
  constructor(
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user || !user.id) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'no_user',
          message: 'SupportAdminGuard требует CookieAuthGuard выше',
        },
      });
    }

    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'SUPPORT_DESK_DISABLED',
          message: 'Служба поддержки не настроена',
        },
      });
    }

    const rbacCtx = await this.rbac.loadContext(user.id, vendorOrgId);
    const allowed = !!rbacCtx && (rbacCtx.isSuperAdmin || rbacCtx.role === 'owner');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'SUPPORT_ADMIN_REQUIRED',
          message: 'Только владелец вендор-Org или супер-админ',
        },
      });
    }

    req.tenantId = vendorOrgId;
    return true;
  }
}
