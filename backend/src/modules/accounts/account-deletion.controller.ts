import { Controller, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { AccountsService } from './accounts.service';

const SESSION_COOKIE = 'z_session';

@ApiExcludeController()
@Controller('api/v1/account')
export class AccountDeletionController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CookieAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async deleteAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Req() _req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const result = await this.accounts.deleteAccount(user.id);
    res.clearCookie(SESSION_COOKIE, {
      domain: this.cfg.auth.cookieStandaloneDomain ?? this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
    });
    return result;
  }
}
