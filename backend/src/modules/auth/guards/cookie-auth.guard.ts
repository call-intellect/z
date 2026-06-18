import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { JwtService } from '../services/jwt.service';

const COOKIE_NAME = 'z_session';

@Injectable()
export class CookieAuthGuard implements CanActivate {
  private readonly logger = new Logger(CookieAuthGuard.name);

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
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

    let payload;
    try {
      payload = this.jwt.verifySession(token);
    } catch {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'cookie_invalid', message: 'Сессия недействительна' },
      });
    }

    if (payload.jti) {
      const session = await this.prisma.userSession.findUnique({
        where: { jti: payload.jti },
      });
      const now = Date.now();
      const valid =
        session !== null && session.revokedAt === null && session.expiresAt.getTime() > now;
      if (!valid) {
        throw new UnauthorizedException({
          ok: false,
          error: { code: 'session_revoked', message: 'Сессия больше недействительна' },
        });
      }
    } else {
      this.logger.debug(
        { sub: payload.sub, role: payload.role },
        'CookieAuthGuard: legacy session без jti (Crossmark/admin)',
      );
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      ...(payload.jti ? { jti: payload.jti } : {}),
    };
    return true;
  }

  private readCookie(req: Request, name: string): string | undefined {
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
