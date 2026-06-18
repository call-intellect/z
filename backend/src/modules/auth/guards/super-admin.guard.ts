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

@Injectable()
export class SuperAdminGuard implements CanActivate {
  private readonly logger = new Logger(SuperAdminGuard.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string; isSuperAdmin?: boolean } | null }>();
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
    user.isSuperAdmin = true;
    return true;
  }
}
