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

import { PrismaService } from '../../../common/prisma/prisma.service';
import { SubscriptionService } from '../services/subscription.service';

import { REQUIRE_SUBSCRIPTION_KEY } from './require-subscription.decorator';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  private static readonly BYPASS_PATH_PREFIXES = [
    '/api/v1/billing',
    '/api/v1/subscription',
    '/api/v1/auth',
  ];

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_SUBSCRIPTION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    if (ctx.getType() !== 'http') return true;

    const req = ctx.switchToHttp().getRequest<
      Request & {
        tenantId?: string;
        user?: { id?: string; isSuperAdmin?: boolean } | null;
      }
    >();

    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true;
    }

    const path = req.path ?? req.url ?? '';
    if (SubscriptionGuard.BYPASS_PATH_PREFIXES.some((p) => path.startsWith(p))) {
      return true;
    }

    if (await this.isSuperAdmin(req.user)) {
      return true;
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'tenant_required',
          message:
            'Не передан заголовок X-Org-Id или путь без параметра :orgId. Невозможно определить организацию для проверки подписки.',
        },
      });
    }

    const sub = await this.subscriptions.getByTenant(tenantId);
    if (sub?.status === 'ACTIVE') return true;

    const currentStatus = sub?.status ?? 'DEMO';

    this.logger.debug(
      { tenantId, status: currentStatus },
      'SubscriptionGuard: блокировка — подписка не активна',
    );

    const isDemo = currentStatus === 'DEMO';
    throw new ForbiddenException({
      ok: false,
      error: {
        code: isDemo ? 'subscription_demo' : 'subscription_expired',
        message: isDemo
          ? 'Оплатите подписку, чтобы начать работу'
          : 'Подписка закончилась — продлите, чтобы продолжить работу',
        currentStatus,
        price: 60_000,
        currency: 'RUB',
        paymentUrl: '/settings/subscription',
      },
    });
  }

  private async isSuperAdmin(
    user: { id?: string; isSuperAdmin?: boolean } | null | undefined,
  ): Promise<boolean> {
    if (!user || !user.id) return false;
    if (user.isSuperAdmin === true) return true;
    if (user.isSuperAdmin === false) return false;
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isSuperAdmin: true },
    });
    const isAdmin = dbUser?.isSuperAdmin === true;
    user.isSuperAdmin = isAdmin;
    return isAdmin;
  }
}
