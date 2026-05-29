import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { NotAuthorizedError } from '../../common/errors/domain-errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminLoginService } from '../auth/services/admin-login.service';

import { AccountsService } from './accounts.service';
import { LoginSchema, type LoginDto } from './dto/login.dto';
import { LoginInvalidError } from './exceptions/accounts-errors';

const SESSION_COOKIE = 'z_session';

/**
 * Единый логин для обычных пользователей и супер-админов.
 *
 *   POST /api/v1/auth/login  { email, password }
 *
 * Пробует по очереди:
 *   1) standalone-аккаунт (argon2id, AccountsService.login);
 *   2) admin-аккаунт (bcrypt, AdminLoginService.login).
 * Любой неуспех — единый `LoginInvalidError` (защита от user-enumeration:
 * каждый путь сам тратит время на фейковый verify своего типа хеша).
 *
 * Оба пути выставляют один и тот же cookie `z_session`, который валидирует
 * `CookieAuthGuard`. Фронт по `{ isSuperAdmin, role }` решает редирект
 * (супер-админ → доступен `/admin`, иначе `/dashboard`).
 *
 * Старые эндпоинты `/accounts/login` и `/auth/admin-login` пока сохранены
 * (deprecated, обратная совместимость) — см. plans/tz/2026-05-29-unified-login.md.
 */
@ApiExcludeController()
@Controller('api/v1/auth')
export class UnifiedLoginController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AdminLoginService) private readonly adminLogin: AdminLoginService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    user: { id: string; email: string; name: string; role: 'user' | 'admin' };
    role: 'user' | 'admin';
    isSuperAdmin: boolean;
    mustChangePassword: boolean;
  }> {
    const meta = {
      userAgent:
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ip: req.ip ?? null,
    };

    // 1) Standalone-аккаунт (argon2id).
    try {
      const r = await this.accounts.login(body, meta);
      this.setSession(res, r.token);
      return {
        user: { id: r.user.id, email: r.user.email, name: r.user.name, role: r.user.role },
        role: r.user.role,
        isSuperAdmin: r.user.isSuperAdmin === true,
        mustChangePassword: r.mustChangePassword,
      };
    } catch (err) {
      if (!(err instanceof LoginInvalidError)) throw err;
    }

    // 2) Admin-аккаунт (bcrypt, role='admin').
    try {
      const r = await this.adminLogin.login(body.email, body.password);
      this.setSession(res, r.sessionToken);
      return {
        user: { id: r.user.id, email: r.user.email, name: r.user.name, role: r.user.role },
        role: r.user.role,
        isSuperAdmin: r.user.isSuperAdmin === true,
        mustChangePassword: r.user.mustChangePassword,
      };
    } catch (err) {
      // Любой провал admin-пути → единая ошибка логина (без user-enumeration).
      if (err instanceof NotAuthorizedError) throw new LoginInvalidError();
      throw err;
    }
  }

  /**
   * Единый cookie для обоих путей. Domain — `cookieStandaloneDomain ?? cookieDomain`
   * (как у /accounts/login): в проде это родительский домен, покрывающий и app,
   * и admin-поддомен, поэтому admin-сессия валидна на `/admin`.
   */
  private setSession(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, {
      domain: this.cfg.auth.cookieStandaloneDomain ?? this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.cfg.auth.sessionTtlSeconds * 1000,
    });
  }
}
