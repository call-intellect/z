import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Guard для Z-Admin (Фаза 7): требует `User.isSuperAdmin === true`.
 *
 * Должен использоваться ПОСЛЕ `CookieAuthGuard`:
 *   `@UseGuards(CookieAuthGuard, SuperAdminGuard)`
 *
 * Алгоритм:
 *   - читает `req.user.id` (положенный CookieAuthGuard'ом).
 *   - lookup в БД (`User.isSuperAdmin`). Lookup кэшируется на запрос через
 *     `req.user.isSuperAdmin` — повторные guard-вызовы внутри одной цепочки
 *     middleware не бьют БД.
 *   - если false — `NotAuthorizedError('super_admin_required')` (HTTP 403).
 *
 * Намеренно не используем JWT-claim isSuperAdmin: смена флага в БД должна
 * применяться без перевыпуска сессии. Кэш membership'ов в RbacService
 * имеет TTL 60s, что достаточно для production.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  private readonly logger = new Logger(SuperAdminGuard.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<
      Request & { user?: { id?: string; isSuperAdmin?: boolean } | null }
    >();
    const user = request.user;
    if (!user || !user.id) {
      throw new NotAuthorizedError('super_admin_required');
    }

    if (user.isSuperAdmin === true) return true;

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isSuperAdmin: true },
    });
    if (!dbUser || !dbUser.isSuperAdmin) {
      throw new NotAuthorizedError('super_admin_required');
    }
    // Кэшируем в request для downstream guards/interceptors.
    user.isSuperAdmin = true;
    return true;
  }
}
