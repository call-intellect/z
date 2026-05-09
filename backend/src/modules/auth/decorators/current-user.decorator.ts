import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';


export interface CurrentUserPayload {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

/**
 * Достаёт `req.user`, заполненный `CookieAuthGuard`. Может быть `null` при
 * `@OptionalAuth()` без cookie. Если guard не подключён — будет `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload | null | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user ?? undefined;
  },
);
