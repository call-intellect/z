import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RbacService } from '../rbac.service';

/**
 * TenantGuard — проверяет, что текущий пользователь имеет Membership в Org,
 * выбранной для запроса. Подключается ПОСЛЕ CookieAuthGuard.
 *
 * Алгоритм извлечения tenantId:
 *   1. Заголовок `X-Org-Id` (приоритет — нужен для multi-org аккаунтов).
 *   2. Параметр URL `:orgId` (например, `/api/v1/orgs/:orgId/...`).
 *   3. Тело запроса `body.tenantId` или `body.orgId`.
 *   4. Если у пользователя ровно одна активная Org — она дефолт.
 *
 * Если tenantId извлечён, но membership нет → 403.
 * Если super_admin — пропускает любой tenantId без membership.
 *
 * После успеха кладёт `req.tenantId = <orgId>` для удобства downstream-кода.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user || !user.id) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'TenantGuard требует CookieAuthGuard выше' },
      });
    }

    const tenantId = await this.resolveTenantId(req, user.id);
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Не удалось определить организацию (X-Org-Id или :orgId не передан)',
        },
      });
    }

    const rbacCtx = await this.rbac.loadContext(user.id, tenantId);
    if (!rbacCtx) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'no_membership',
          message: 'У вас нет доступа к этой организации',
        },
      });
    }

    // Кладём в req для downstream-кода (controllers, services).
    (req as Request & { tenantId?: string }).tenantId = tenantId;
    return true;
  }

  private async resolveTenantId(
    req: Request,
    userId: string,
  ): Promise<string | null> {
    // 1. Заголовок X-Org-Id.
    const headerVal = req.headers['x-org-id'];
    if (typeof headerVal === 'string' && headerVal.trim().length > 0) {
      return headerVal.trim();
    }

    // 2. URL-параметр :orgId.
    const params = (req as Request & { params?: Record<string, string> }).params;
    if (params?.orgId && typeof params.orgId === 'string') {
      return params.orgId;
    }

    // 3. body.tenantId или body.orgId.
    const body = (req as Request & { body?: Record<string, unknown> }).body;
    if (body) {
      const t = body['tenantId'];
      const o = body['orgId'];
      if (typeof t === 'string' && t.length > 0) return t;
      if (typeof o === 'string' && o.length > 0) return o;
    }

    // 4. Дефолт — единственная активная Org юзера.
    const memberships = await this.prisma.membership.findMany({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      take: 2,
    });
    if (memberships.length === 1 && memberships[0]) {
      return memberships[0].orgId;
    }
    if (memberships.length === 0) {
      this.logger.debug({ userId }, 'TenantGuard: у пользователя нет активных Org');
      return null;
    }
    // Несколько Org — нужен явный X-Org-Id.
    return null;
  }
}
