import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { SupportAccessService } from '../services/support-access.service';

/**
 * SupportAccessGuard — пускает в деск поддержки ТОЛЬКО членов группы-контура
 * вендор-Org (Р-7). Подключается ПОСЛЕ CookieAuthGuard.
 *
 * Алгоритм:
 *   1. Нет `req.user` → 403 `no_user` (CookieAuthGuard выше обязателен).
 *   2. `SupportAccessService.isAgent(user.id)` === false → 403 `SUPPORT_NOT_AGENT`.
 *   3. Иначе кладёт `req.tenantId = vendorOrgId`, чтобы desk-контроллеры
 *      работали в scope вендор-Org (NOT TenantGuard — деск всегда вендор-Org,
 *      не «текущая Org» сотрудника).
 */
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

    // Деск всегда работает в scope вендор-Org. Сотрудник прошёл isAgent →
    // vendorOrgId гарантированно существует (иначе isAgent вернул бы false).
    const vendorOrgId = await this.access.getVendorOrgId();
    if (vendorOrgId) {
      req.tenantId = vendorOrgId;
    }
    return true;
  }
}
