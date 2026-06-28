import { Inject, Injectable } from '@nestjs/common';
import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';

import { TypedConfigService } from '../../../common/config/index';

const ISSUER = 'z';
const AUDIENCE = 'z';
const ALGORITHM: jwt.Algorithm = 'HS256';

export interface SessionPayload {
  sub: string;
  email: string;
  role: 'user' | 'admin';
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

export interface ExternalGuestSessionPayload {
  userId: string;
  conversationId: string;
  accessLinkId: string;
}

export interface VerifiedExternalGuestSessionPayload extends ExternalGuestSessionPayload {
  exp: number;
}

export interface BitrixStatePayload {
  purpose: 'bitrix_oauth';
  sub: string;
  domain: string;
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

const GUEST_SESSION_TTL_SECONDS = 24 * 60 * 60;

const EXTERNAL_GUEST_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

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

  get guestSessionTtlSeconds(): number {
    return GUEST_SESSION_TTL_SECONDS;
  }

  signExternalGuestSession(payload: ExternalGuestSessionPayload): string {
    const options: SignOptions = {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: EXTERNAL_GUEST_SESSION_TTL_SECONDS,
    };
    return jwt.sign(payload, this.cfg.auth.sessionSecret, options);
  }

  verifyExternalGuestSession(token: string): VerifiedExternalGuestSessionPayload {
    const verifyOptions: VerifyOptions = {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    };
    const decoded = jwt.verify(token, this.cfg.auth.sessionSecret, verifyOptions);
    return this.assertExternalGuestSessionPayload(decoded);
  }

  get externalGuestSessionTtlSeconds(): number {
    return EXTERNAL_GUEST_SESSION_TTL_SECONDS;
  }

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

  private assertExternalGuestSessionPayload(
    decoded: unknown,
  ): VerifiedExternalGuestSessionPayload {
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('JWT payload должен быть объектом');
    }
    const obj = decoded as Record<string, unknown>;
    const userId = obj['userId'];
    const conversationId = obj['conversationId'];
    const accessLinkId = obj['accessLinkId'];
    const exp = obj['exp'];
    if (
      typeof userId !== 'string' ||
      typeof conversationId !== 'string' ||
      typeof accessLinkId !== 'string' ||
      typeof exp !== 'number'
    ) {
      throw new Error('Невалидный external-guest-session JWT payload');
    }
    return { userId, conversationId, accessLinkId, exp };
  }
}
