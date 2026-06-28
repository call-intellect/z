import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtService } from '../../auth/services/jwt.service';

const COOKIE_NAME = 'z_external_session';

export interface ExternalGuestRequest extends Request {
  externalGuest?: {
    userId: string;
    conversationId: string;
    accessLinkId: string;
  };
}

@Injectable()
export class ExternalGuestGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<ExternalGuestRequest>();
    const token = this.readToken(request);
    if (!token) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Нет доступа к этому разговору' },
      });
    }

    let payload;
    try {
      payload = this.jwt.verifyExternalGuestSession(token);
    } catch {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Нет доступа к этому разговору' },
      });
    }

    const paramId = request.params?.['id'];
    if (!paramId || paramId !== payload.conversationId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Нет доступа к этому разговору' },
      });
    }

    request.externalGuest = {
      userId: payload.userId,
      conversationId: payload.conversationId,
      accessLinkId: payload.accessLinkId,
    };
    return true;
  }

  private readToken(request: ExternalGuestRequest): string | null {
    const header = request.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const bearer = header.slice('Bearer '.length).trim();
      if (bearer.length > 0) return bearer;
    }
    const cookieHeader = request.headers?.cookie;
    if (typeof cookieHeader === 'string') {
      for (const part of cookieHeader.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === COOKIE_NAME) {
          const value = rest.join('=');
          if (value.length > 0) return decodeURIComponent(value);
        }
      }
    }
    return null;
  }
}
