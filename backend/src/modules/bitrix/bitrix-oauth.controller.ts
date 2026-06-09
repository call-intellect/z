import { Controller, Get, Inject, Logger, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { TypedConfigService } from '../../common/config/index';

import { BitrixIntegrationService } from './bitrix-integration.service';

/**
 * Public OAuth2-callback Bitrix24 (способ A).
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md.
 *
 * Маршрут: `GET /api/v1/bitrix/oauth/callback` (без авторизации — Bitrix
 * редиректит сюда браузер). Меняет `code` на токены (tenantId берётся из
 * подписанного `state`), затем 302-редиректит браузер на страницу настроек
 * фронта с `?bitrix=connected|error`.
 */
@ApiExcludeController()
@Controller('api/v1/bitrix/oauth')
export class BitrixOAuthController {
  private readonly logger = new Logger(BitrixOAuthController.name);

  constructor(
    @Inject(BitrixIntegrationService)
    private readonly service: BitrixIntegrationService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('member_id') memberId: string | undefined,
    @Query('scope') scope: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const base = `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}/settings/integrations`;
    try {
      const { portalDomain } = await this.service.handleOAuthCallback({
        code,
        state,
        memberId,
        scope,
        error,
      });
      res.redirect(
        `${base}?bitrix=connected&domain=${encodeURIComponent(portalDomain)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Bitrix OAuth callback error: ${message}`);
      res.redirect(`${base}?bitrix=error`);
    }
  }
}
