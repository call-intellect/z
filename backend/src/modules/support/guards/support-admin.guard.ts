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
