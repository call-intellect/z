import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { SupportAccessService } from '../services/support-access.service';

@Injectable()
export class SupportAccessGuard implements CanActivate {
  constructor(
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user || !user.id) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'no_user',
          message: 'SupportAccessGuard требует CookieAuthGuard выше',
        },
      });
    }

    const ok = await this.access.isAgent(user.id);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'SUPPORT_NOT_AGENT',
          message: 'Вы не сотрудник поддержки',
        },
      });
    }

    const vendorOrgId = await this.access.getVendorOrgId();
    if (vendorOrgId) {
      req.tenantId = vendorOrgId;
    }
    return true;
  }
}
