import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { TypedConfigService } from '../../common/config/index';
import {
  DeepLinkExpiredError,
  DeepLinkMismatchError,
  NotAuthorizedError,
} from '../../common/errors/domain-errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from '../users/users.service';

import { CurrentUser, type CurrentUserPayload } from './decorators/current-user.decorator';
import { OptionalAuth } from './decorators/optional-auth.decorator';
import { CookieAuthGuard } from './guards/cookie-auth.guard';
import { JwtService } from './services/jwt.service';

/**
 * Имя cookie session — синхронизировано с `CookieAuthGuard`.
 */
const SESSION_COOKIE = 'z_session';

const ExchangeQuerySchema = z.object({
  token: z.string().min(1, 'token обязателен'),
  meeting_id: z.string().min(1, 'meeting_id обязателен'),
});

/**
 * Auth-контроллер.
 *
 *   GET  /api/v1/auth/exchange — обмен deep-link JWT на session cookie.
 *   GET  /api/v1/auth/me       — кто я по cookie (или `null`).
 *   POST /api/v1/auth/logout   — погасить cookie.
 */
@ApiExcludeController()
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Get('exchange')
  async exchange(
    @Query(new ZodValidationPipe(ExchangeQuerySchema))
    query: { token: string; meeting_id: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true; redirect: string }> {
    let payload;
    try {
      payload = this.jwt.verifyDeepLink(query.token);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new DeepLinkExpiredError();
      }
      // Любые другие ошибки верификации — трактуем как невалидный токен.
      throw new NotAuthorizedError('deep_link_invalid');
    }

    if (payload.meetingId !== query.meeting_id) {
      throw new DeepLinkMismatchError();
    }

    const user = await this.users.findById(payload.sub);
    if (!user) throw new NotAuthorizedError('user_not_found');

    const sessionJwt = this.jwt.signSession({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    response.cookie(SESSION_COOKIE, sessionJwt, {
      domain: this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });

    return { ok: true, redirect: `/m/${payload.meetingId}` };
  }

  @Get('me')
  @UseGuards(CookieAuthGuard)
  @OptionalAuth()
  async me(
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ): Promise<{
    user:
      | { id: string; email: string; name: string; role: 'user' | 'admin' }
      | null;
  }> {
    if (!user) return { user: null };
    const fresh = await this.users.findById(user.id);
    if (!fresh) return { user: null };
    return {
      user: {
        id: fresh.id,
        email: fresh.email,
        name: fresh.name,
        role: fresh.role,
      },
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response): { ok: true } {
    response.clearCookie(SESSION_COOKIE, {
      domain: this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
    });
    return { ok: true };
  }
}
