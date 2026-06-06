import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeAccessResolver } from '../knowledge-access-resolver.service';
import { RbacService } from '../rbac.service';

/**
 * TenantGuard — проверяет, что текущий пользователь имеет Membership в Org,
 * выбранной для запроса. Подключается ПОСЛЕ CookieAuthGuard.
 *
 * Алгоритм извлечения tenantId:
 *   1. `req.tenantId`, уже выставленный TenantMiddleware (X-Org-Id /
 *      :orgId / body.tenantId).
 *   2. Single-org fallback: если у пользователя ровно одна активная Org —
 *      она дефолт. Делается только здесь, т.к. требует `req.user.id`
 *      после CookieAuthGuard.
 *
 * Если tenantId не разрезолвлен → 403 tenant_required.
 * Если tenantId есть, но membership нет → 403 no_membership.
 *
 * После успеха кладёт `req.tenantId = <orgId>` для удобства downstream-кода
 * (идемпотентно — middleware могло уже выставить то же значение).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      Request & {
        rbacContext?: {
          role: string;
          visibility: string;
          isSuperAdmin: boolean;
          groups?: unknown;
        };
      }
    >();
    const user = req.user;
    if (!user || !user.id) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'TenantGuard требует CookieAuthGuard выше' },
      });
    }

    // Middleware уже могло выставить req.tenantId (из header/param/body).
    let tenantId = req.tenantId;
    if (!tenantId) {
      // Single-org fallback — единственная стратегия, требующая БД и user.id.
      tenantId = (await this.singleOrgFallback(user.id)) ?? undefined;
    }

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

    // Кладём в req для downstream-кода (даже если уже стояло — идемпотентно).
    req.tenantId = tenantId;
    // 2026-06-01 (ТЗ shared-demo-org-model §4.3) — кэшируем rbacCtx для
    // downstream guards/handlers, чтобы избежать повторного loadContext.
    req.rbacContext = {
      role: rbacCtx.role,
      visibility: rbacCtx.visibility,
      isSuperAdmin: rbacCtx.isSuperAdmin,
    };
    // Ф2 knowledge-access — лениво кладём группы пользователя ТОЛЬКО при включённом
    // гейте (off → ничего не делаем, поведение неизменно).
    if (this.cfg.knowledgeAccess.enforcement !== 'off') {
      try {
        const groups = await this.accessResolver.resolveAccessibleGroups({
          tenantId, userId: user.id,
        });
        (req.rbacContext as Record<string, unknown>)['groups'] = groups;
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'TenantGuard: резолв групп доступа упал — пропускаем (best-effort)',
        );
      }
    }
    return true;
  }

  private async singleOrgFallback(userId: string): Promise<string | null> {
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
    }
    return null;
  }
}
