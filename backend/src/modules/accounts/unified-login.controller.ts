import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
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
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ip: req.ip ?? null,
    };

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
      if (err instanceof NotAuthorizedError) throw new LoginInvalidError();
      throw err;
    }
  }

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
