import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { JwtService } from '../services/jwt.service';
import { OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';


/**
 * Guard для пользовательских endpoint'ов:
 *   - читает cookie `z_session`;
 *   - валидирует через `JwtService.verifySession`;
 *   - кладёт `req.user = { id, email, role }`.
 *
 * При отсутствии cookie:
 *   - если у роута есть `@OptionalAuth()` — пропускает с `req.user = null`;
 *   - иначе — `UnauthorizedException` (401).
 *
 * При невалидной/просроченной cookie — всегда 401 (даже с `@OptionalAuth()`,
 * чтобы фронт мог однозначно увидеть `auth:expired` и инициировать логин).
 */
const COOKIE_NAME = 'z_session';

@Injectable()
export class CookieAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<Request>();
    const isOptional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const token = this.readCookie(request, COOKIE_NAME);

    if (!token) {
      if (isOptional) {
        request.user = null;
        return true;
      }
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'cookie_missing', message: 'Требуется авторизация' },
      });
    }

    try {
      const payload = this.jwt.verifySession(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'cookie_invalid', message: 'Сессия недействительна' },
      });
    }
  }

  private readCookie(req: Request, name: string): string | undefined {
    // `cookie-parser` middleware заполняет `req.cookies`. Без него — fallback на
    // парс заголовка, чтобы guard был самодостаточен в тестах.
    const fromParser = (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
    if (fromParser) return fromParser;

    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx);
      if (key === name) {
        return decodeURIComponent(trimmed.slice(idx + 1));
      }
    }
    return undefined;
  }
}
