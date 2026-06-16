import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import { RbacService } from '../../rbac/rbac.service';

@Injectable()
export class OrgAdminGuard implements CanActivate {
  constructor(@Inject(RbacService) private readonly rbac: RbacService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string } | null; tenantId?: string }>();
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
