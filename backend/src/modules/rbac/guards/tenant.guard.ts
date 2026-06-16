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

    let tenantId = req.tenantId;
    if (!tenantId) {
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

    req.tenantId = tenantId;
    req.rbacContext = {
      role: rbacCtx.role,
      visibility: rbacCtx.visibility,
      isSuperAdmin: rbacCtx.isSuperAdmin,
    };
    if (this.cfg.knowledgeAccess.enforcement !== 'off') {
      try {
        const groups = await this.accessResolver.resolveAccessibleGroups({
          tenantId,
          userId: user.id,
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
