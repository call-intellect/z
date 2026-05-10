import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import { RbacService } from '../../rbac/rbac.service';

/**
 * Guard для Org-Admin (Фаза 7): требует роль `owner` или `admin` в Membership
 * для текущего tenant'а (определяется `TenantGuard`'ом).
 *
 * Должен использоваться ПОСЛЕ `CookieAuthGuard + TenantGuard`:
 *   `@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)`
 *
 * Алгоритм:
 *   - читает `req.user.id` и `req.tenantId`.
 *   - вызывает `RbacService.canManageOrg(userId, tenantId)`.
 *   - если false — `NotAuthorizedError('org_admin_required')` (HTTP 403).
 *
 * NB: `canManageOrg` проверяет либо `User.isSuperAdmin`, либо `role === 'owner'`.
 * Чтобы дать `admin`-роли тоже доступ к Org-Admin (как этого требует ТЗ Фазы 7,
 * раздел 7.B), используем расширенную проверку прямо здесь — `loadContext`
 * + проверка роли `owner|admin`.
 */
@Injectable()
export class OrgAdminGuard implements CanActivate {
  constructor(@Inject(RbacService) private readonly rbac: RbacService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      Request & { user?: { id?: string } | null; tenantId?: string }
    >();
    const userId = req.user?.id;
    const tenantId = req.tenantId;
    if (!userId || !tenantId) {
      throw new NotAuthorizedError('org_admin_required');
    }

    const ctxRbac = await this.rbac.loadContext(userId, tenantId);
    if (!ctxRbac) {
      throw new NotAuthorizedError('org_admin_required');
    }
    if (ctxRbac.isSuperAdmin) return true;
    if (ctxRbac.role === 'owner' || ctxRbac.role === 'admin') return true;
    throw new NotAuthorizedError('org_admin_required');
  }
}
