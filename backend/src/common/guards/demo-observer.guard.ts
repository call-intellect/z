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

import { RbacService } from '../../modules/rbac/rbac.service';

import { PUBLIC_DEMO_KEY } from './public-demo.decorator';

@Injectable()
export class DemoObserverGuard implements CanActivate {
  private readonly logger = new Logger(DemoObserverGuard.name);

  private static readonly BYPASS_PATH_PREFIXES = [
    '/api/v1/billing',
    '/api/v1/subscription',
    '/api/v1/auth',
    '/api/v1/accounts/me',
    '/api/v1/me/',
    '/api/v1/entitlements/me',
  ];

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const req = ctx.switchToHttp().getRequest<
      Request & {
        tenantId?: string;
        user?: { id?: string; isSuperAdmin?: boolean } | null;
        rbacContext?: { role: string; visibility: string; isSuperAdmin: boolean };
      }
    >();

    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true;
    }

    const path = req.path ?? req.url ?? '';
    if (DemoObserverGuard.BYPASS_PATH_PREFIXES.some((p) => path.startsWith(p))) {
      return true;
    }

    const isPublicDemo = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_DEMO_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublicDemo === true) return true;

    const user = req.user;
    if (!user || !user.id) return true;
    if (user.isSuperAdmin === true) return true;

    const tenantId = req.tenantId;
    if (!tenantId) return true;

    const rbacCtx = await this.rbac.loadContext(user.id, tenantId);
    if (!rbacCtx) return true;

    req.rbacContext = {
      role: rbacCtx.role,
      visibility: rbacCtx.visibility,
      isSuperAdmin: rbacCtx.isSuperAdmin,
    };

    if (rbacCtx.isSuperAdmin) return true;
    if (this.rbac.canMutate(rbacCtx.role)) return true;

    this.logger.debug(
      { userId: user.id, tenantId, role: rbacCtx.role, method: req.method, path },
      'DemoObserverGuard: mutation blocked',
    );

    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'demo_observer_readonly',
        message:
          'Это демо-кабинет «Демо: ТехноСтрим» — здесь доступен только просмотр. Чтобы создавать данные, переключитесь в свою компанию и оплатите подписку.',
      },
    });
  }
}
