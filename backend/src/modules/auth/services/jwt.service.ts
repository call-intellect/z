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
  /**
   * JWT ID. Опциональное поле — заполняется только для standalone-сессий
   * (создаются в `AccountsService.login`), чтобы привязать JWT к записи
   * `UserSession` и иметь возможность принудительного отзыва.
   * Для legacy Crossmark-сессий и admin-логина — отсутствует.
   */
  jti?: string;
}

export interface DeepLinkPayload {
  sub: string;
  meetingId: string;
}

export interface GuestSessionPayload {
  participantId: string;
  meetingId: string;
}

/**
 * State для OAuth-коннекта Bitrix24 (способ A). Подписывается `sessionSecret`,
 * живёт коротко (BITRIX_STATE_TTL_SECONDS). Поле `purpose` отделяет его от
 * прочих JWT, `sub` = tenantId инициатора, `domain` = домен портала.
 */
export interface BitrixStatePayload {
  purpose: 'bitrix_oauth';
  sub: string; // tenantId
  domain: string; // портал, напр. acme.bitrix24.ru
}

export interface VerifiedBitrixStatePayload extends BitrixStatePayload {
  exp: number;
}

export interface VerifiedSessionPayload extends SessionPayload {
  exp: number;
  jti?: string;
}

export interface VerifiedDeepLinkPayload extends DeepLinkPayload {
  exp: number;
}

export interface VerifiedGuestSessionPayload extends GuestSessionPayload {
  exp: number;
}

/** TTL гостевой cookie — 24 часа. Это «прошёл капчу/ввёл имя один раз — не повторяем». */
const GUEST_SESSION_TTL_SECONDS = 24 * 60 * 60;

/** TTL Bitrix OAuth-state — 15 минут (как у Tochka). */
const BITRIX_STATE_TTL_SECONDS = 15 * 60;

@Injectable()
export class JwtService {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  signSession(payload: SessionPayload): string {
    const options: SignOptions = {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.cfg.auth.sessionTtlSeconds,
      ...(payload.jti ? { jwtid: payload.jti } : {}),
    };
    // jti кладём через `jwtid` опцию — иначе jsonwebtoken игнорирует поле в payload.
    const { jti: _jti, ...rest } = payload;
    return jwt.sign(rest, this.cfg.auth.sessionSecret, options);
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

  /** Подписать state для OAuth-коннекта Bitrix24 (короткоживущий). */
  signBitrixState(payload: Omit<BitrixStatePayload, 'purpose'>): string {
    const options: SignOptions = {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: BITRIX_STATE_TTL_SECONDS,
    };
    const full: BitrixStatePayload = { purpose: 'bitrix_oauth', ...payload };
    return jwt.sign(full, this.cfg.auth.sessionSecret, options);
  }

  /** Проверить state из Bitrix-callback. Бросает на истёкшем/чужом токене. */
  verifyBitrixState(token: string): VerifiedBitrixStatePayload {
    const verifyOptions: VerifyOptions = {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    };
    const decoded = jwt.verify(token, this.cfg.auth.sessionSecret, verifyOptions);
    return this.assertBitrixStatePayload(decoded);
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
    const jti = obj['jti'];
    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      (role !== 'user' && role !== 'admin') ||
      typeof exp !== 'number'
    ) {
      throw new Error('Невалидный session JWT payload');
    }
    return {
      sub,
      email,
      role,
      exp,
      ...(typeof jti === 'string' ? { jti } : {}),
    };
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

  private assertBitrixStatePayload(decoded: unknown): VerifiedBitrixStatePayload {
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('JWT payload должен быть объектом');
    }
    const obj = decoded as Record<string, unknown>;
    const purpose = obj['purpose'];
    const sub = obj['sub'];
    const domain = obj['domain'];
    const exp = obj['exp'];
    if (
      purpose !== 'bitrix_oauth' ||
      typeof sub !== 'string' ||
      typeof domain !== 'string' ||
      typeof exp !== 'number'
    ) {
      throw new Error('Невалидный bitrix-state JWT payload');
    }
    return { purpose, sub, domain, exp };
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
