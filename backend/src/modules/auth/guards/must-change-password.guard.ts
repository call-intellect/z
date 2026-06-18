import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface WhitelistRule {
  method: string;
  prefix: string;
}

const WHITELIST: WhitelistRule[] = [
  { method: 'GET', prefix: '/api/v1/me' },
  { method: 'POST', prefix: '/api/v1/me/change-password' },
  { method: 'POST', prefix: '/api/v1/me/set-initial-password' },
  { method: 'GET', prefix: '/api/v1/me/onboarding' },
  { method: 'POST', prefix: '/api/v1/me/onboarding' },
  { method: 'PATCH', prefix: '/api/v1/me/onboarding' },
  { method: 'POST', prefix: '/api/v1/auth/logout' },
  { method: 'POST', prefix: '/api/v1/accounts/logout' },
  { method: 'GET', prefix: '/api/v1/entitlements/me' },
];

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  private readonly logger = new Logger(MustChangePasswordGuard.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = (req as Request & { user?: { id?: string } | null }).user;
    if (!user || !user.id) {
      return true;
    }

    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { mustChangePassword: true, deletedAt: true },
    });
    if (!row || row.deletedAt) {
      return true;
    }
    if (!row.mustChangePassword) {
      return true;
    }

    if (this.isWhitelisted(req.method, req.path)) {
      return true;
    }

    this.metrics.incMustChangePasswordBlock({ path: req.path });
    this.logger.warn(
      { userId: user.id, method: req.method, path: req.path },
      'must_change_password: запрос отклонён, пользователь обязан сменить пароль',
    );
    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'must_change_password',
        message:
          'Необходимо сменить пароль перед использованием системы. ' +
          'Перейдите на /onboarding/change-password.',
      },
    });
  }

  private isWhitelisted(method: string, path: string): boolean {
    const upperMethod = method.toUpperCase();
    for (const rule of WHITELIST) {
      if (rule.method !== upperMethod) continue;
      if (path === rule.prefix) return true;
      if (path.startsWith(`${rule.prefix}/`)) return true;
      if (path.startsWith(`${rule.prefix}?`)) return true;
    }
    return false;
  }
}
