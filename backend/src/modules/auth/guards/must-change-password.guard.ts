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

/**
 * audit Б2 (2026-05-29) — глобальный backend-guard для флага
 * `User.mustChangePassword`.
 *
 * Контекст: после фикса Б1 пользователь из инвайта входит по credentials
 * из письма и сразу получает `mustChangePassword=true`. На фронте
 * `AuthenticatedShell` редиректит его на `/onboarding/change-password`,
 * но **бекенд этого не проверяет**. curl/postman/старая SPA-вкладка
 * могут продолжать дёргать API с валидной cookie. Guard закрывает дыру.
 *
 * Поведение:
 *   - Если `req.user == null` (роут не использует CookieAuthGuard,
 *     либо помечен `@OptionalAuth()` без cookie) — пропускаем.
 *   - Иначе тянем `User.mustChangePassword` из БД (SELECT one row).
 *   - Если `false` — пропускаем.
 *   - Если `true`:
 *     - проверяем whitelist по path/method (см. `WHITELIST`);
 *     - если в whitelist — пропускаем;
 *     - иначе → 403 `must_change_password`.
 *
 * Глобально регистрируется через `APP_GUARD` в `AppModule`. Прозрачен
 * для всех роутов кроме помеченных юзером с флагом.
 *
 * Метрика: `auth_must_change_password_block_total{path}`.
 */

interface WhitelistRule {
  method: string;
  /** Префикс path (req.path с глобальным `/api/v1`). */
  prefix: string;
}

/**
 * Endpoints, доступные при `mustChangePassword=true`. Минимальный набор,
 * чтобы пользователь мог сменить пароль и узнать свой статус.
 * Подбираем по path с глобальным префиксом `/api/v1`.
 */
const WHITELIST: WhitelistRule[] = [
  { method: 'GET', prefix: '/api/v1/me' },
  { method: 'POST', prefix: '/api/v1/me/change-password' },
  { method: 'POST', prefix: '/api/v1/me/set-initial-password' },
  // Любые /me/onboarding/* — read и write (POST/PATCH/GET).
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
      // Публичный роут или OptionalAuth без cookie — пропускаем.
      return true;
    }

    // Один SELECT по PK — дёшево. Если позже захочется кешировать —
    // достаточно повесить Redis с TTL 30 сек. На MVP не нужно.
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { mustChangePassword: true, deletedAt: true },
    });
    if (!row || row.deletedAt) {
      // Юзер удалён — пусть CookieAuthGuard или 404 разберут на своём слое.
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
