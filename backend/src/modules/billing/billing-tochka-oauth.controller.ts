/**
 * BillingTochkaOAuthController — OAuth2 callback от Точки.
 *
 * Маршрут: `GET /api/v1/internal/billing/tochka/oauth/callback` (public).
 *
 * Точка редиректит сюда после авторизации в браузере с параметрами
 * `?code=...&state=...` или `?error=...`. Сервис обменивает code на токены
 * и сохраняет их в `BillingProviderConfig`.
 *
 * Возвращает HTML-страничку с результатом (для отображения в браузере).
 *
 * Также содержит admin-эндпоинт `GET /api/v1/admin/billing/tochka/oauth/authorize-url`
 * — отдаёт URL для подключения Точки. Только super_admin.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.3 + §11.4.
 */

import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

import { TochkaOAuthService } from './providers/tochka/tochka-oauth.service';

@ApiTags('billing-tochka-oauth')
@Controller('api/v1')
export class BillingTochkaOAuthController {
  constructor(
    @Inject(TochkaOAuthService) private readonly oauth: TochkaOAuthService,
  ) {}

  /** Public-callback от Точки после авторизации. */
  @Get('internal/billing/tochka/oauth/callback')
  @ApiOperation({ summary: 'OAuth callback от Точки (public).' })
  async handleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.oauth.handleOAuthCallback({
        code,
        state,
        error,
        errorDescription,
      });
      res
        .status(200)
        .type('html')
        .send(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Точка подключена</title></head>` +
            `<body><h1>OAuth подключен</h1>` +
            `<p>Refresh token: ${result.hasRefreshToken ? 'да' : 'нет'}</p>` +
            `<p>Истекает: ${result.expiresAt ?? 'не указано'}</p>` +
            `</body></html>`,
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(400)
        .type('html')
        .send(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>OAuth error</title></head>` +
            `<body><h1>Ошибка OAuth</h1><pre>${message}</pre></body></html>`,
        );
    }
  }

  /** Admin: получить URL для подключения Точки (открыть в браузере). */
  @Get('admin/billing/tochka/oauth/authorize-url')
  @UseGuards(CookieAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'URL для авторизации в Точке (super_admin). Открыть в браузере.',
  })
  async getAuthorizeUrl(): Promise<{ url: string }> {
    const url = await this.oauth.createAuthorizationUrl();
    return { url };
  }

  /** Admin: ручной trigger ensureOAuthReady (полезно после изменения ENV). */
  @Post('admin/billing/tochka/oauth/ensure-ready')
  @UseGuards(CookieAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Triger TochkaOAuthService.ensureOAuthReady (super_admin).' })
  async ensureReady(): Promise<{ ok: true }> {
    await this.oauth.ensureOAuthReady();
    return { ok: true };
  }
}
