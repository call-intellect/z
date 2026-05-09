import { Inject, Injectable } from '@nestjs/common';
import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';

import { TypedConfigService } from '../../../common/config/index';

/**
 * JWT-сервис для двух потоков:
 *
 *  - **session JWT** (`signSession` / `verifySession`) — кладётся в cookie `z_session`.
 *  - **deep-link JWT** (`signDeepLink` / `verifyDeepLink`) — однократный токен,
 *    приходит в URL и обменивается на cookie на первом GET'е страницы встречи.
 *
 * Алгоритм фиксирован — `HS256`. `issuer` и `audience` = `'z'` для обоих потоков.
 * Секреты и TTL — из ENV через `TypedConfigService`.
 */

const ISSUER = 'z';
const AUDIENCE = 'z';
const ALGORITHM: jwt.Algorithm = 'HS256';

export interface SessionPayload {
  sub: string;
  email: string;
  role: 'user' | 'admin';
}

export interface DeepLinkPayload {
  sub: string;
  meetingId: string;
}

export interface GuestSessionPayload {
  participantId: string;
  meetingId: string;
}

export interface VerifiedSessionPayload extends SessionPayload {
  exp: number;
}

export interface VerifiedDeepLinkPayload extends DeepLinkPayload {
  exp: number;
}

export interface VerifiedGuestSessionPayload extends GuestSessionPayload {
  exp: number;
}

/** TTL гостевой cookie — 24 часа. Это «прошёл капчу/ввёл имя один раз — не повторяем». */
const GUEST_SESSION_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class JwtService {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  signSession(payload: SessionPayload): string {
    const options: SignOptions = {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.cfg.auth.sessionTtlSeconds,
    };
    return jwt.sign(payload, this.cfg.auth.sessionSecret, options);
  }

  verifySession(token: string): VerifiedSessionPayload {
    const verifyOptions: VerifyOptions = {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    };
    const decoded = jwt.verify(token, this.cfg.auth.sessionSecret, verifyOptions);
    return this.assertSessionPayload(decoded);
  }

  signDeepLink(payload: DeepLinkPayload): string {
    const options: SignOptions = {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.cfg.auth.deepLinkTtlSeconds,
    };
    return jwt.sign(payload, this.cfg.auth.deepLinkSecret, options);
  }

  verifyDeepLink(token: string): VerifiedDeepLinkPayload {
    const verifyOptions: VerifyOptions = {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    };
    const decoded = jwt.verify(token, this.cfg.auth.deepLinkSecret, verifyOptions);
    return this.assertDeepLinkPayload(decoded);
  }

  /**
   * Гостевая cookie `guest_session_<meetingId>`. Подписывается тем же
   * `sessionSecret` (отдельный issuer/audience не нужен — поле `meetingId`
   * однозначно отделяет её от обычной session JWT).
   */
  signGuestSession(payload: GuestSessionPayload): string {
    const options: SignOptions = {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: GUEST_SESSION_TTL_SECONDS,
    };
    return jwt.sign(payload, this.cfg.auth.sessionSecret, options);
  }

  verifyGuestSession(token: string): VerifiedGuestSessionPayload {
    const verifyOptions: VerifyOptions = {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    };
    const decoded = jwt.verify(token, this.cfg.auth.sessionSecret, verifyOptions);
    return this.assertGuestSessionPayload(decoded);
  }

  /** TTL guest-сессии в секундах — для подсчёта `maxAge` cookie в контроллере. */
  get guestSessionTtlSeconds(): number {
    return GUEST_SESSION_TTL_SECONDS;
  }

  private assertSessionPayload(decoded: unknown): VerifiedSessionPayload {
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('JWT payload должен быть объектом');
    }
    const obj = decoded as Record<string, unknown>;
    const sub = obj['sub'];
    const email = obj['email'];
    const role = obj['role'];
    const exp = obj['exp'];
    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      (role !== 'user' && role !== 'admin') ||
      typeof exp !== 'number'
    ) {
      throw new Error('Невалидный session JWT payload');
    }
    return { sub, email, role, exp };
  }

  private assertDeepLinkPayload(decoded: unknown): VerifiedDeepLinkPayload {
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('JWT payload должен быть объектом');
    }
    const obj = decoded as Record<string, unknown>;
    const sub = obj['sub'];
    const meetingId = obj['meetingId'];
    const exp = obj['exp'];
    if (typeof sub !== 'string' || typeof meetingId !== 'string' || typeof exp !== 'number') {
      throw new Error('Невалидный deep-link JWT payload');
    }
    return { sub, meetingId, exp };
  }

  private assertGuestSessionPayload(decoded: unknown): VerifiedGuestSessionPayload {
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('JWT payload должен быть объектом');
    }
    const obj = decoded as Record<string, unknown>;
    const participantId = obj['participantId'];
    const meetingId = obj['meetingId'];
    const exp = obj['exp'];
    if (
      typeof participantId !== 'string' ||
      typeof meetingId !== 'string' ||
      typeof exp !== 'number'
    ) {
      throw new Error('Невалидный guest-session JWT payload');
    }
    return { participantId, meetingId, exp };
  }
}
