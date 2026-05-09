import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';


/**
 * Guard, требующий `req.user.role === 'admin'`.
 *
 * Должен использоваться ПОСЛЕ `CookieAuthGuard`:
 *   `@UseGuards(CookieAuthGuard, AdminGuard)`
 *
 * При несоблюдении — `NotAuthorizedError('admin_required')` (403).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user || user.role !== 'admin') {
      throw new NotAuthorizedError('admin_required');
    }
    return true;
  }
}
