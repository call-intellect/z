import { Injectable } from '@nestjs/common';
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

export interface VerifiedSessionPayload extends SessionPayload {
  exp: number;
}

export interface VerifiedDeepLinkPayload extends DeepLinkPayload {
  exp: number;
}

@Injectable()
export class JwtService {
  constructor(private readonly cfg: TypedConfigService) {}

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
}
