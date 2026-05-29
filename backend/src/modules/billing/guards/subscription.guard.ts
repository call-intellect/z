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

/**
 * SubscriptionGuard — глобально зарегистрированный guard (paywall без trial).
 *
 * Источник: plans/tz/2026-05-28-paywall-no-trial.md §3.
 *
 * Цепочка guard'ов: CookieAuthGuard → TenantGuard → SubscriptionGuard →
 * EntitlementGuard → RbacGuard. Регистрируется через APP_GUARD в AppModule.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  /** Пути, которые guard НИКОГДА не блокирует (ТЗ §3.2 — оплата и просмотр подписки). */
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

    const req = ctx
      .switchToHttp()
      .getRequest<
        Request & {
          tenantId?: string;
          user?: { id?: string; isSuperAdmin?: boolean } | null;
        }
      >();

    // ТЗ §3.2: GET-запросы (read-only) пропускаются — DEMO видит данные.
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true;
    }

    // ТЗ §3.2: /billing/*, /subscription/*, /auth/* — без paywall (оплата/логин).
    const path = req.path ?? req.url ?? '';
    if (SubscriptionGuard.BYPASS_PATH_PREFIXES.some((p) => path.startsWith(p))) {
      return true;
    }

    // audit В2 (2026-05-29): bypass для super-admin'ов. Они работают с
    // tenant-данными для саппорта/демо/админских правок и не должны
    // упираться в paywall чужой Org. Проверяем cached `req.user.isSuperAdmin`,
    // если undefined — один lookup в БД (та же логика, что в SuperAdminGuard).
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
            'SubscriptionGuard требует TenantGuard выше (req.tenantId не выставлен).',
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

    // audit В2 (2026-05-29): разделяем error code между DEMO (никогда не
    // платили — нужен первичный CTA «оплатить») и EXPIRED/PAST_DUE/SUSPENDED/
    // CANCELED (уже платили, нужен CTA «продлить»). Фронт по этому коду
    // показывает разный UI: DEMO → калькулятор + кнопка «Купить», EXPIRED
    // → «Продлить с прежними параметрами» + last invoice info.
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

  /**
   * audit В2: super-admin bypass. Сначала смотрим cached флаг (поставлен
   * SuperAdminGuard'ом для admin-роутов), при отсутствии — один SELECT
   * в БД с кэшированием в req.user.isSuperAdmin для downstream guards.
   */
  private async isSuperAdmin(
    user: { id?: string; isSuperAdmin?: boolean } | null | undefined,
  ): Promise<boolean> {
    if (!user || !user.id) return false;
    if (user.isSuperAdmin === true) return true;
    if (user.isSuperAdmin === false) return false; // явный кэш «не админ»
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isSuperAdmin: true },
    });
    const isAdmin = dbUser?.isSuperAdmin === true;
    user.isSuperAdmin = isAdmin;
    return isAdmin;
  }
}
