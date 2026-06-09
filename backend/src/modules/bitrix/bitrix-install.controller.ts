import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { BitrixIntegrationService } from './bitrix-integration.service';

/**
 * Public-приёмник событий установки Bitrix24 (способ B).
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md.
 *
 * Маршрут: `POST /api/v1/bitrix/install/event` (без авторизации — зовёт Bitrix).
 * Bitrix присылает `application/x-www-form-urlencoded` с вложенными `auth[...]`
 * (парсится express.urlencoded extended:true в объект `auth`).
 *
 *   - `ONAPPINSTALL`   → сохранить токены портала в `pending` (привязка к org —
 *     позже через claim из iframe-handler).
 *   - `ONAPPUNINSTALL` → пометить `disconnected` (подлинность по application_token).
 *
 * Best-effort: на любую внутреннюю ошибку отвечаем 200, чтобы Bitrix не
 * зацикливал ретраи. Kill-switch — `bitrix.enabled`.
 */
@ApiExcludeController()
@Controller('api/v1/bitrix/install')
export class BitrixInstallController {
  private readonly logger = new Logger(BitrixInstallController.name);

  constructor(
    @Inject(BitrixIntegrationService)
    private readonly service: BitrixIntegrationService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
  ) {}

  @Post('event')
  @HttpCode(HttpStatus.OK)
  async event(@Body() body: unknown): Promise<{ ok: true }> {
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('bitrix install event: bitrix.enabled=false — no-op');
        return { ok: true };
      }

      const root = asRecord(body);
      const event = String(root['event'] ?? '').toUpperCase();
      const auth = asRecord(root['auth']);
      const applicationToken =
        str(root['application_token']) ?? str(auth['application_token']);

      if (event === 'ONAPPINSTALL') {
        await this.service.onAppInstall({
          member_id: str(auth['member_id']),
          access_token: str(auth['access_token']),
          refresh_token: str(auth['refresh_token']),
          expires_in: str(auth['expires_in']),
          domain: str(auth['domain']),
          client_endpoint: str(auth['client_endpoint']),
          server_endpoint: str(auth['server_endpoint']),
          scope: str(auth['scope']),
          application_token: applicationToken,
        });
      } else if (event === 'ONAPPUNINSTALL') {
        await this.service.onAppUninstall({
          member_id: str(auth['member_id']),
          application_token: applicationToken,
        });
      } else {
        this.logger.debug(`bitrix install event: неизвестное событие "${event}"`);
      }
    } catch (err) {
      this.logger.error(
        `bitrix install event: обработка не удалась — отвечаю 200: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { ok: true };
  }
}

/** Безопасно привести к объекту-записи. */
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Достать строку (Bitrix form-encoded шлёт всё строками). */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
